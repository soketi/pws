const { DynamoDB } = require('@aws-sdk/client-dynamodb');

let ddb = new DynamoDB({
    region: 'us-east-1',
    endpoint: `http://${process.env.DYNAMODB_URL || '127.0.0.1:8000'}`,
});

let createRecord = () => {
    const params = {
        TableName: 'apps',
        Item: {
            AppId: { S: 'app-id' },
            AppKey: { S: 'app-key' },
            AppSecret: { S: 'app-secret' },
            MaxConnections: { N: '-1' },
            EnableClientMessages: { B: 'false' },
            Enabled: { B: 'true' },
            MaxBackendEventsPerSecond: { N: '-1' },
            MaxClientEventsPerSecond: { N: '-1' },
            MaxReadRequestsPerSecond: { N: '-1' },
            Webhooks: { S: '[]', },

            /**
             * The following fields are optional. It's not a problem, because DynamoDB is NoSQL.
             * If one of the following fields doesn't exist,
             * the default ones defined at the server-level will take priority.
             */
            // MaxPresenceMembersPerChannel: { N: '-1' },
            // MaxPresenceMemberSizeInKb: { N: '-1' },
            // MaxChannelNameLength: { N: '-1' },
            // MaxEventChannelsAtOnce: { N: '-1' },
            // MaxEventNameLength: { N: '-1' },
            // MaxEventPayloadInKb: { N: '-1' },
            // MaxEventBatchSize: { N: '-1' },
            // EnableUserAuthentication: { B: 'false' }
        },
    };

    return ddb.putItem(params).then(() => {
        console.log('Record created.');
    }).catch(err => {
        console.error(err);
        console.log('Record already existent.');
    });
};

ddb.describeTable({ TableName: 'apps' }).then((result) => {
    createRecord();
}).catch(err => {
    console.error(err);

    ddb.createTable({
        TableName: 'apps',
        AttributeDefinitions: [
            {
                AttributeName: 'AppId',
                AttributeType: 'S',
            },
            {
                AttributeName: 'AppKey',
                AttributeType: 'S',
            },
        ],
        KeySchema: [{
            AttributeName: 'AppId',
            KeyType: 'HASH',
        }],
        GlobalSecondaryIndexes: [{
            IndexName: 'AppKeyIndex',
            KeySchema: [{
                AttributeName: 'AppKey',
                KeyType: 'HASH',
            }],
            Projection: {
                ProjectionType: 'ALL',
            },
            ProvisionedThroughput: {
                ReadCapacityUnits: 100,
                WriteCapacityUnits: 100,
            },
        }],
        StreamSpecification: {
            StreamEnabled: false,
        },
        ProvisionedThroughput: {
            ReadCapacityUnits: 100,
            WriteCapacityUnits: 100,
        },
    }).then(() => {
        console.log('Table created.');
    }).then(createRecord).catch((err) => {
        console.error(err);
        console.log('Table already existent.');
    });
});
