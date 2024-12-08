import { App } from './../app';
import { AppManagerInterface } from './app-manager-interface';
import { ArrayAppManager } from './array-app-manager';
import { DynamoDbAppManager } from './dynamodb-app-manager';
import { Log } from '../log';
import { MysqlAppManager } from './mysql-app-manager';
import { PostgresAppManager } from './postgres-app-manager';
import { SqliteAppManager } from './sqlite-app-manager';
import { Server } from '../server';

/**
 * Class that controls the key/value data store.
 */
export class AppManager implements AppManagerInterface {
    /**
     * The application manager driver.
     */
    public driver: AppManagerInterface;

    /**
     * Create a new database instance.
     */
    constructor(protected server: Server) {
        switch (server.options.appManager.driver) {
            case 'array':
                this.driver = new ArrayAppManager(server);
                break;
            case 'mysql':
                this.driver = new MysqlAppManager(server);
                break;
            case 'postgres':
                this.driver = new PostgresAppManager(server);
                break;
            case 'sqlite':
                this.driver = new SqliteAppManager(server);
                break;
            case 'dynamodb':
                this.driver = new DynamoDbAppManager(server);
                break;
            default:
                Log.error('Clients driver not set.');
        }
    }

    /**
     * Find an app by given ID.
     */
    findById(id: string): Promise<App|null> {
        if (!this.server.options.appManager.cache.enabled) {
            return this.driver.findById(id);
        }

        return this.server.cacheManager.get(`app:${id}`).then(appFromCache => {
            if (appFromCache) {
                return new App(JSON.parse(appFromCache), this.server);
            }

            return this.driver.findById(id).then(app => {
                this.server.cacheManager.set(`app:${id}`, app ? app.toJson() : app, this.server.options.appManager.cache.ttl);

                return app;
            });
        });
    }

    /**
     * Find an app by given key.
     */
    findByKey(key: string): Promise<App|null> {
        if (!this.server.options.appManager.cache.enabled) {
            return this.driver.findByKey(key);
        }

        return this.server.cacheManager.get(`app:${key}`).then(appFromCache => {
            if (appFromCache) {
                return new App(JSON.parse(appFromCache), this.server);
            }

            return this.driver.findByKey(key).then(app => {
                this.server.cacheManager.set(`app:${key}`, app ? app.toJson() : app, this.server.options.appManager.cache.ttl);

                return app;
            });
        });
    }

    /**
     * Get the app secret by ID.
     */
    getAppSecret(id: string): Promise<string|null> {
        return this.driver.getAppSecret(id);
    }
}
