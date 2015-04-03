'use strict';

/**
 * This works like the same method in Mongo.Collection
 * but difference is that this method can check document before it will be published by UniCollection.publish
 * The available callbacks are:
 *
 * @param options.publish {function} publish(userId, doc, publicationName)
 * The user 'userId' wants to subscribe document 'doc' from this collection.
 * The name of publication 'publicationName' if is available.
 * Return true if this should be allowed.
 * WARNING: This rule will be respected only by 'UniCollection.publish',
 * Meteor.publish is expected to do their own access to checking instead relying on allow and deny.
 *
 * @param options.disable {function} ( not implemented yet )
 * @param options.insert {function}
 * @param options.update {function}
 * @param options.remove {function}
 */
UniCollection.prototype.allow = function(options){
    Mongo.Collection.prototype.allow.call(this, _addUniverseValidators.call(this, 'allow', options));
};

UniUsers.allow = function(options){
    Meteor.users.allow.call(this, _addUniverseValidators.call(this, 'allow', options));
};

/**
 * This works like the same method in Mongo.Collection
 * but difference is that this method can check document before it will be published by UniCollection.publish
 * The available callbacks are:
 *
 * @param options.publish {function} publish(userId, doc, publicationName)
 * The user 'userId' wants to subscribe document 'doc' from this collection.
 * The name of publication 'publicationName' if is available.
 * Return true if this should be disallowed.
 * WARNING: This rule will be respected only by 'UniCollection.publish',
 * Meteor.publish is expected to do their own access to checking instead relying on allow and deny.
 *
 * @param options.disable {function} ( not implemented yet )
 * @param options.insert {function}
 * @param options.update {function}
 * @param options.remove {function}
 */
UniCollection.prototype.deny = function(options){
    Mongo.Collection.prototype.deny.call(this, _addUniverseValidators.call(this, 'deny', options));
};

UniUsers.deny = function(options){
    Meteor.users.deny.call(this, _addUniverseValidators.call(this, 'deny', options));
};

var _addUniverseValidators = function(allowOrDeny, options) {
    var myKeys = ['publish', 'disable'];
    var self = this;
    if(!self._universeValidators){
        self._universeValidators = {
            publish: {allow: [], deny: []},
            disable: {allow: [], deny: []}
        };
    }

    _.each(options, function(fn, key){
        if(_.contains(myKeys, key)){
            if(!_.isFunction(fn)){
                throw new Error(allowOrDeny + ': Value for `' + key + '` must be a function');
            }
            self._universeValidators[key][allowOrDeny].push(fn);
        }
    });

    return _.omit(options, myKeys);
};

if(Meteor.isServer){
    UniCollection._publications = {};
    /**
     * Publish with Access control, this is the replacement of Meteor.publish.
     * It works for non-universe collections in the same way like Meteor.publish (without access control)
     * But for UniCollection, the access is checked for every document and published are only those,
     * which are allowed only if passed any 'publish' allow and deny rules
     *
     * @param name Name of the record set.
     * If null, the set has no name, and the record set is automatically sent to all connected clients (with access control)
     * @param handler Function called on the server each time a client subscribes.
     * Inside the function, this is the publish handler object, described below.
     * If the client passed arguments to subscribe, the function is called with the same arguments.
     * @param options.override {boolean} resets handler for publication name. (only named publication can be overridden)
     * @returns {*}
     */
    UniCollection.publish = function(name, handler, options){
        if(!_.isFunction(handler)){
            throw new Meteor.Error(404, 'UniCollection.publish: handler must be an function');
        }
        if(name){
            var isAlreadyDefined = !!UniCollection._publications[name];
            if(isAlreadyDefined && (!options  || !options.override)){
                throw new Meteor.Error(403, 'Publication is already declared for name: "'+name+'", ' +
                'if you want override it, set override: true in options');
            }
            UniCollection._publications[name] = handler;
            if(isAlreadyDefined){
                return;
            }
        }
        var newHandler = function(){
            this._directAdded = this.added;
            this._directChanged = this.changed;
            this._directRemoved = this.removed;
            this._uniMappingsObs = {};
            this._uniDocCounts = {};
            this._uniMappings = {};

            this.added = addedHandler;
            this.changed = changedHandler;
            this.removed = removedHandler;

            this.setMappings = function(collectionName, mappings){
                if(_.isObject(collectionName) && collectionName._name){
                    collectionName = collectionName._name;
                }
                if(!_.isArray(mappings)){
                    throw Meteor.Error(500, 'Parameter mappings must be an array of object');
                }
                if(!_.isString(collectionName)){
                    throw Meteor.Error(500, 'CollectionName must be a string or collection object');
                }
                this._uniMappings[collectionName] = mappings;
            };
            if(name){
                handler = UniCollection._publications[name];
            }
            var curs = handler.apply(this, arguments);
            if(curs){
                _eachCursorsCheck.call(this, curs);
            }
        };

        Meteor.publish(name, newHandler);
    };
    var _prepareUniDocCount = function(collectionName, id){
        this._uniDocCounts[collectionName] = this._uniDocCounts[collectionName] || {};
        this._uniDocCounts[collectionName][id] =
            this._uniDocCounts[collectionName][id] || 0;
    };


    var addedHandler = function(collectionName, id, doc) {
        _prepareUniDocCount.call(this, collectionName, id, doc);
        var col = UniCollection._uniCollections[collectionName];
        //checks if no universe collection
        if(!col){
            this._uniDocCounts[collectionName][id]++;
            this._directAdded(collectionName, id, doc);
            _doMapping.call(this, id, doc, collectionName);
            return true;
        } else if (_validateRules.call(col, this.userId, doc, this._name)) {
            this._uniDocCounts[collectionName][id]++;
            this._directAdded(collectionName, id, doc);
            _doMapping.call(this, id, doc, collectionName);
            return true;
        }

    };

    var changedHandler = function(collectionName, id, changedFields, allowedFields) {
        var col = UniCollection._uniCollections[collectionName];
        //checks if no universe collection
        if(!col){
            this._directChanged(collectionName, id, changedFields);
            _doMapping.call(this, id, changedFields, collectionName);
            return;
        }
        var hasOldDoc = UniUtils.get(this, '_documents.'+collectionName+'.'+id);
        var doc = col.findOne(id, {fields: allowedFields || undefined});
        var newAccess = _validateRules.call(col, this.userId, doc, this._name);
        //if we lost access
        if (hasOldDoc && !newAccess) {
            return removedHandler.call(this, collectionName, id);
        }
        //if we gained access, quickly adds doc
        if(!hasOldDoc && newAccess) {
            return addedHandler.call(this, collectionName, id, doc);
        }
        //adding changes
        this._directChanged(collectionName, id, changedFields);
        _doMapping.call(this, id, doc, collectionName);
        return true;
    };

    var removedHandler = function(collectionName, id) {
        if(!this._uniDocCounts[collectionName] || this._uniDocCounts[collectionName][id] <= 0) {
            return;
        }
        --this._uniDocCounts[collectionName][id];
        if(!this._uniDocCounts[collectionName][id]){
            delete this._uniDocCounts[collectionName][id];
            _stopObserveHandlesAndCleanUp.call(this, collectionName, id);
            return this._directRemoved(collectionName, id);
        }

    };

    var _validateRules = function(userId, doc, publicationName){
        var publishValids = UniUtils.get(this, '_universeValidators.publish');
        if(publishValids){
            if(publishValids.deny){
                if(_.some(publishValids.deny, function(fn){ return fn(userId, doc, publicationName);})){
                    return false;
                }
            }
            if(publishValids.allow){
                return _.some(publishValids.allow, function(fn){ return fn(userId, doc, publicationName);});
            }
        }
        return false;
    };

   var _eachCursorsCheck = function(curs, _parentDocId){
        if(!_.isArray(curs)) {
            curs = [curs];
        }
       var sub = this;
        if(curs.length) {
            var handles = _.map(curs, function (cursor) {
                if (!_.isObject(cursor) || !cursor.observeChanges) {
                    throw Meteor.Error(500, 'Publish function can only return a Cursor or an array of Cursors');
                }
                var collName = cursor._getCollectionName();
                var obs = {docs:{}, name: collName};
                var allowedFields = UniUtils.get(cursor._cursorDescription, 'options.fields');
                obs.handle = cursor.observeChanges({
                    added: function (id, fields) {
                        obs.docs[id] = true;
                        sub.added(collName, id, fields);
                    },
                    changed: function (id, fields) {
                        sub.changed(collName, id, fields, allowedFields);
                    },
                    removed: function (id) {
                        obs.docs[id] = undefined;
                        sub.removed(collName, id);
                    }
                });
                return obs;
            });
            if(!_parentDocId){
                sub.ready();
            }
            sub.onStop(function () {
                _.each(handles, function(h){
                    h && h.handle && h.handle.stop();
                });
            });
            return handles;
        }
    };

    var _doMapping = function(id, doc, collectionName) {
        var mappings = this._uniMappings[collectionName];
        if (!mappings) {
            return;
        }
        var sub = this;
        var mapFilter;
        _.each(mappings, function(mapping){
            mapFilter = {};
            if (mapping.reverse) {
                mapFilter[mapping.key] = id;
            } else {
                mapFilter._id = doc[mapping.key];
                if(!mapFilter._id){
                    return;
                }
                if (_.isArray(mapFilter._id)) {
                    if(!mapFilter._id.length){
                        return;
                    }
                    mapFilter._id = {
                        $in: mapFilter._id
                    };
                }
            }
            _.extend(mapFilter, mapping.filter);
            var key = mapping.reverse && '_reverse';
            //stopping and clearing up of observers
            _stopObserveHandlesAndCleanUp.call(sub, collectionName, id, key);
            var handles = _eachCursorsCheck.call(sub, mapping.collection.find(mapFilter, mapping.options), id);
            //adding new observers
            handles && _saveObserveHandles.call(sub, collectionName, id, key, handles[0]);
        });

    };

    var _saveObserveHandles = function(collectionName, id, key, handles){
        UniUtils.set(this._uniMappingsObs, collectionName+'.'+id+'.'+key, handles);
    };

    /**
     * Stops subscriptions and removes old docs
     * @param sub
     * @param collectionName
     * @param id
     * @param key
     * @private
     */

    var _stopObserveHandlesAndCleanUp = function(collectionName, id, key){
        var toStopping;
        var sub = this;
        if(key){
            toStopping = {'key': UniUtils.get(sub._uniMappingsObs, collectionName+'.'+id+'.'+key)};
        } else{
            toStopping = UniUtils.get(sub._uniMappingsObs, collectionName+'.'+id) || {};
        }
        _.each(toStopping, function(obs){
            if(obs){
                obs.handle && obs.handle.stop();
                obs.docs && _.each(obs.docs, function(v, i){
                    v && sub.removed(obs.name, i);
                });
                obs.docs = {};
            }
        });
    };

}

