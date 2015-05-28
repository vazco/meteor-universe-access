Package.describe({
    summary: 'Allows to set a document level access/permission rules for publication and control it in allow/deny',
    name: 'vazco:universe-access',
    version: '1.1.4',
    git: 'https://github.com/vazco/meteor-universe-collection'
});

Package.on_use(function (api) {
    api.versionsFrom(['METEOR@1.0.4']);
    api.use([
        'underscore',
        'mongo',
        'vazco:universe-utilities@1.0.6',
        'vazco:universe-collection@1.1.0'
    ]);

    api.add_files([
        'UniCollectionExtension.js'
    ]);

});
