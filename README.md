# Universe Access

#### This is extension of  [Universe Collection & Mappings](https://atmospherejs.com/vazco/universe-collection) #####

This package allows to set a document level access/permission rules for publication.
You can control access using collection function allow/deny with new key publish.

Additionally package provides possibility of override once defined publication handler.

## Installation

```sh
$ meteor add vazco:universe-access
```

## Publishing

UniCollection.publish - Publish with Access control, this is the replacement of Meteor.publish.
It works for non-universe collections in the same way like Meteor.publish (without access control)
But for UniCollection, the access is checked for every document and published are only those,
which are allowed only, it means that document must pass by any 'publish' allow and deny rules.
Additionally this function provide a mappings of others documents.
You can map UniCollection documents like as non-UniCollection documents.

## Options
- **override** - gives possibility of override once defined publication handler.
    You can do that by passing override = true in options of UniCollection.publish.

```
var options = { override: true };
UniCollection.publish(name, handler, options);
```

## Simple way

```
UniCollection.publish('example', function() {
    return [Colls.MyColl.find(), Colls.Books.find()];
});
```

You can return one Collection.Cursor, an array of Collection.Cursors.
If a publish function does not return a cursor or array of cursors,
it is assumed to be using the low-level added/changed/removed interface, and it must also call ready once the initial record set is complete.

## Low-level publish api

```
UniCollection.publish('example', function() {
    var self = this;
    var handle = Colls.Books.find({roomId: roomId}).observeChanges({
        added: function (id, fields) {
            self.added("books", id, fields);
        },
        changed: function (id, fields, allowedFields) {
            self.changed("books", id, fields);
        },
        removed: function (id, fields) {
            self.removed("books", id);
        }
    });
    self.onStop(function () {
        handle.stop();
    });
});
```

- **allowedFields** Dictionary of fields possible return or exclude from it.
    ( They should be the same as was passed to options.fields in find() method. )
    You can get allowed/excluded fields directly from cursor:
``` Server side:
var allowedFields = cursor._cursorDescription.options.fields
```

## Using with build-in mappings

This package provides simple way mapping mechanism.
You must return base collection or collections and using method setMappings, define relational mappings


```
UniCollection.publish('example', function() {
    this.setMappings(Colls.MyColl, [
        //Map a value of organisationsIds from selected documents of Colls.MyColl to document from Colls.Rooms
        {
            key: 'organisationsIds',
            collection: Colls.Rooms
        },
        //Map ids of selected document of Colls.MyColl to document from Meteor.users where orgIds = id
        {
                    key: 'orgIds',
                    collection: Meteor.users,
                    reverse: true // reverse direction of the relationship (inverse relationship is more complex)
        }
    ]);
    //For mapped users you can map another documents
    this.setMappings(Meteor.users, [
            {
                key: 'organisationsIds',
                collection: Colls.Rooms,
                reverse: true

            }
    ]);
    //And another....
    this.setMappings(Colls.Rooms, [
        {
            key: 'roomId',
            reverse:true,
            collection: Colls.Documents,
            options: {fields: { title: 1 }}
        }
    ]);

    return Colls.MyColl.find();
});
```

## Access control

UniCollection.publish published all non-UniCollection documents
and ONLY those documents, which have at least one rule fulfilled in {UniCollection}.allow 'publish' method and all non fulfilled rule in {UniCollection}.deny 'publish'.
IF YOU NEVER SET UP ANY PUBLISH METHOD IN ALLOW rules on a collection then all documents on the collection will be DENIED!

Additionally collection of users can be treated as universe collection.
You should prefer UniUsers instead Meteor.users

### Allow

```js
Colls.Organisations.allow({
    insert: function (userId){
        return true;
    },
    update: function (userId, doc, fieldNames){
        return true;
    },
    remove: function (userId, doc){
        return true;
    },
    publish: function(userId, doc, publicationName){
        return true;
    }
});
```
As you can see everything is like in Mongo.Collection.allow with one additionally callback.

*publish(userId, doc, publicationName)*

The user 'userId' wants to subscribe document 'doc' from this collection.
The name of publication 'publicationName' if is available.
Return true if this should be allowed.
WARNING: This rule will be respected only by 'UniCollection.publish',
Meteor.publish is expected to do their own access to checking instead relying on allow and deny.

### Deny

```js
Colls.Organisations.deny({
    insert: function (userId){
        return false;
    },
    update: function (userId, doc, fieldNames){
        return false;
    },
    remove: function (userId, doc){
        return true;
    },
    publish: function(userId, doc, publicationName){
        return false;
    }
});
```

*publish(userId, doc, publicationName)*

The user 'userId' wants to subscribe document 'doc' from this collection.
The name of publication 'publicationName' if is available.
Return true if this should be disallowed.

**WARNING:** This rule will be respected only by 'UniCollection.publish',
Meteor.publish is expected to do their own access to checking instead relying on allow and deny.
