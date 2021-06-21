const express = require('express');
const app = express();
const port = 3000;

app.get('/pws/app', (req, res) => {
    if (req.query.token !== process.env.APPS_MANAGER_TOKEN) {
        res.statusCode = 401;
        return res.json({ error: 'Unauthenticated' });
    }

    if (!req.query.appId && !req.query.appKey) {
        res.statusCode = 404;
        return res.json({ app: null });
    }

    if (req.query.appId && req.query.appId !== 'app') {
        res.statusCode = 404;
        return res.json({ app: null });
    }

    if (req.query.appKey && req.query.appKey !== 'app-key') {
        res.statusCode = 404;
        return res.json({ app: null });
    }

    res.json({
        app: {
            id: 'app',
            key: 'app-key',
            secret: 'app-secret',
            maxConnections: 100,
            enableClientMessages: true,
            maxBackendEventsPerSecond: -1,
            maxClientEventsPerSecond: -1,
            maxReadRequestsPerSecond: -1,
        },
    });
});

app.listen(port, () => {
  console.log(`Testing API server http://localhost:${port}`);
});
