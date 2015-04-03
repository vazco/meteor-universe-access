Package.describe({
    summary: 'Allows to set a document level access/permission rules for publication and control it in allow/deny',
    name: 'vazco:universe-access',
    version: '1.1.2',
    git: 'https://github.com/vazco/meteor-universe-collection'
});

Package.on_use(function (api) {
    api.versionsFrom(['METEOR@1.0.4']);
    api.use(['templating', 'ui', 'blaze'], 'client');
    api.use([
        'underscore',
        'mongo',
        'vazco:universe-utilities@1.0.3',
        'vazco:universe-collection@1.0.5'
    ]);

    api.add_files([
        'UniCollectionExtension.js'
    ]);

});
