import { App } from './../app';
import { ConsumptionResponse } from './rate-limiter-interface';
import { LocalRateLimiter } from './local-rate-limiter';
import { RateLimiterAbstract } from 'rate-limiter-flexible';
import { Server } from '../server';

export interface ConsumptionMessage {
    app: App;
    eventKey: string;
    points: number;
    maxPoints: number;
    id: string;
}

export class ClusterRateLimiter extends LocalRateLimiter {
    /**
     * Initialize the local rate limiter driver.
     */
    constructor(protected server: Server) {
        super(server);

        server.discover.join('rate_limiter:limiters', ({ rateLimiters, id }: { rateLimiters: { [key: string]: RateLimiterAbstract }[]; id: string; }) => {
            if (id !== this.server.nodes.get('self').id) {
                this.rateLimiters = Object.fromEntries(
                    Object.entries(rateLimiters).map(([key, rateLimiterObject]: [string, any]) => {
                        return [
                            key,
                            this.createNewRateLimiter(key.split(':')[0], rateLimiterObject._points),
                        ];
                    })
                );
            }
        });

        // All nodes need to know when other nodes consumed from the rate limiter.
        server.discover.join('rate_limiter:consume', ({ id, app, eventKey, points, maxPoints }: ConsumptionMessage) => {
            if (id !== this.server.nodes.get('self').id) {
                super.consume(app, eventKey, points, maxPoints);
            }
        });

        server.discover.on('added', () => {
            if (server.nodes.get('self').isMaster) {
                // When a new node is added, just send the rate limiters this master instance has.
                // This value is the true value of the rate limiters.
                this.sendRateLimiters();
            }
        });
    }

    /**
     * Consume points for a given key, then
     * return a response object with headers and the success indicator.
     */
    protected consume(app: App, eventKey: string, points: number, maxPoints: number): Promise<ConsumptionResponse> {
        return super.consume(app, eventKey, points, maxPoints).then((response) => {
            if (response.canContinue) {
                this.server.discover.send('rate_limiter:consume', {
                    app,
                    eventKey,
                    points,
                    maxPoints,
                    id: this.server.nodes.get('self').id,
                });
            }

            return response;
        });
    }

    /**
     * Clear the rate limiter or active connections.
     */
    disconnect(): Promise<void> {
        return super.disconnect().then(() => {
            // If the current instance is the master and the server is closing,
            // demote and send the rate limiter of the current instance to the new master.
            if (this.server.nodes.get('self').isMaster) {
                this.server.discover.demote();
                this.sendRateLimiters();
            }
        });
    }

    /**
     * Send the stored rate limiters this instance currently have.
     */
    protected sendRateLimiters(): void {
        this.server.discover.send('rate_limiter:limiters', { rateLimiters: this.rateLimiters, id: this.server.nodes.get('self').id });
    }
}
