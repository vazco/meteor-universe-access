Package.describe({
    summary: 'Allows to set a document level access/permission rules for publication and control it in allow/deny',
    name: 'vazco:universe-access',
    version: '1.5.2',
    git: 'https://github.com/vazco/meteor-universe-collection'
});

Package.onUse(function (api) {
    api.versionsFrom(['METEOR@1.0.4']);
    api.use([
        'underscore',
        'mongo',
        'universe:utilities',
        'universe:utilities-blaze',
        'universe:collection'
    ]);

    api.addFiles([
        'UniCollectionExtension.js'
    ]);

});
