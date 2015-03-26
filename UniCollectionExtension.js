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
     * @param options.is_auto auto publish without access control.
     * @returns {*}
     */
    UniCollection.publish = function(name, handler){
        var newHandler = function(){
            var sub = this;
            this._directAdded = this.added;
            this._directChanged = this.changed;
            this._directRemoved = this.removed;
            this._uniObserveHandles = [];
            this._uniMappings = {};

            this.added = function(collectionName, id, doc){
                return _runHandler('added', collectionName, id, doc, sub);
            };
            this.changed = function(collectionName, id, doc){
                return _runHandler('changed', collectionName, id, doc, sub);
            };
            this.removed = function(collectionName, id, doc){
                return _runHandler('removed', collectionName, id, doc, sub);
            };
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
            var curs = handler.apply(this, arguments);
            if(curs){
                _eachCursorsCheck(curs, this);
            }
        };
        return Meteor.publish(name, newHandler);
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

    UniCollection.prototype.Access = {
        /**
         * Handle to notify publication about added doc with checking access rules
         * @param newDocument
         * @param pub 'this' from publication callback
         * @returns {boolean}
         */
        addedHandler: function(newDocument, pub) {
            if (_validateRules.call(this, pub.userId, newDocument, pub._name)) {
                pub.added(this._name, newDocument._id, newDocument);
                _doMapping(newDocument._id, newDocument, pub._uniMappings[this._name], pub._directSub||pub);
                return true;
            }
        },
        /**
         * Handle to notify publication about changed doc with checking access rules
         * @param changedFields
         * @param pub 'this' from publication callback
         * @returns {boolean}
         */
        changedHandler: function(changedFields, pub) {
            var newAccess;
            var hasOldDoc = UniUtils.get(pub, '_documents.'+this._name+'.'+changedFields._id);
            var doc = this.findOne(changedFields._id);
            if(!hasOldDoc) {
                return this.access.addedHandler.call(this, doc, pub);
            }
            newAccess = _validateRules.call(this, pub.userId, doc, pub._name);
            if (!newAccess) {
                return this.access.removedHandler.call(this, changedFields, pub);
            }
            if (newAccess) {
                pub.changed(this._name, changedFields._id, changedFields);
                _doMapping(changedFields._id, changedFields, pub._uniMappings[this._name], pub._directSub||pub);
                return true;
            }
        },
        /**
         * Handle to notify publication about removed doc with checking access rules
         * @param newDocument
         * @param pub 'this' from publication callback
         * @returns {boolean}
         */
        removedHandler: function(oldDocument, pub) {
            var id = UniUtils.getIdIfDocument(oldDocument);
            if(!pub._documents[this._name] || !pub._documents[this._name][id]) {
                return;
            }
            _stopObserveHandlesAndCleanUp(pub._directSub||pub, id);
            return pub.removed(this._name, id);
        }

    };

    var _runHandler = function(handlerName, collectionName, id, doc, directSub){
        var col = UniUtils.get(UniCollection, '_uniCollections.'+collectionName);
        if(_.isObject(col) && col instanceof UniCollection) {
            var handler = UniUtils.get(col, 'Access.'+handlerName+'Handler');
            if(!_.isFunction(handler)){
                throw Error(
                    'Missing access handler for "'+handlerName+'" ('+handlerName+'Handler) collection: '+collectionName
                );
            }

            if(_.isObject(doc) && !doc._id){
                doc._id = id;
            }

            if(!doc && handlerName === 'removed'){
                doc = id;
            }

            //Prepare object for Access Handlers (collection.Access[addedHandler|changedHandler|removeHandler])
            var pub = {
                _directSub: directSub,
                _uniMappings: directSub._uniMappings,
                added: function(){
                    debugger;
                    return directSub._directAdded.apply(this._directSub, arguments);
                },
                changed: function(){
                    return directSub._directChanged.apply(this._directSub, arguments);
                },
                removed: function(){
                    return directSub._directRemoved.apply(this._directSub, arguments);
                },
                userId: directSub.userId,
                _documents: directSub._documents,
                _name: directSub._name
            };
            return handler.call(col, doc, pub);
        }

        if(_.contains(['added', 'changed'], handlerName)){
            _doMapping(id, doc, directSub._uniMappings[collectionName], directSub, collectionName);
        } else if(handlerName === 'removed'){
            _stopObserveHandlesAndCleanUp(directSub, id);
        }

        return directSub[handlerName](collectionName, id, doc);
    };

    var _eachCursorsCheck = function(curs, sub, _parentDocId){
        if(!_.isArray(curs)) {
            curs = [curs];
        }

        if(curs.length) {
            var _docIds;
            _.each(curs, function(cursor) {
                if(!_.isObject(cursor) || !cursor.observeChanges){
                    throw Meteor.Error(500, 'Publish function can only return a Cursor or an array of Cursors');
                }
                var collName = cursor._getCollectionName();
                _docIds = [];
                var observeHandle = cursor.observeChanges({
                    added: function (id, fields) {
                        _docIds.push(id);
                        sub.added(collName, id, fields);
                    },
                    changed: function (id, fields) {
                        sub.changed(collName, id, fields);
                    },
                    removed: function (id) {
                        _docIds = _.without(_docIds, id);
                        sub.removed(collName, id);
                    }
                });
                sub.onStop(function () {observeHandle.stop();});
                if(_parentDocId){
                    if(!sub._uniObserveHandles[_parentDocId]){
                        sub._uniObserveHandles[_parentDocId] = [];
                    }
                    if(!observeHandle){
                        observeHandle = {};
                    }
                    observeHandle._docsIds = _docIds;
                    observeHandle._collectionName = collName;
                    sub._uniObserveHandles[_parentDocId].push(observeHandle);
                }
            });
            if(!_parentDocId){
                sub.ready();
            }
        }
    };

    var _doMapping = function(id, doc, mappings, sub) {
        if (!mappings) {
            return;
        }
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
            _eachCursorsCheck(mapping.collection.find(mapFilter, mapping.options), sub, id);
        });

    };
    /**
     * Stops subscriptions and removes old docs
     * @param sub
     * @param id
     * @private
     */

    var _stopObserveHandlesAndCleanUp = function(sub, id){
        if(sub._uniObserveHandles[id] && sub._uniObserveHandles.length){
            _.each(sub._uniObserveHandles[id], function(h){
                if(h){
                    h.stop && h.stop();
                    if(h._docIds){
                        _.each(h._docIds, function(docId){
                            if(sub._documents[h.collectionName] && sub._documents[h.collectionName][docId]){
                                sub.removed(h.collectionName, docId);
                            }
                        });
                    }
                }
            });
            delete sub._uniObserveHandles[id];
        }
    };

}

