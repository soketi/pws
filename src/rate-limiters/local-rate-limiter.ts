import { App } from './../app';
import { ConsumptionResponse, RateLimiterInterface } from './rate-limiter-interface';
import { RateLimiterAbstract, RateLimiterMemory, RateLimiterRes } from 'rate-limiter-flexible';
import { Server } from '../server';
import { UserDataInterface } from '../adapters/user-data-interface';
import { WebSocket } from 'uWebSockets.js';

export class LocalRateLimiter implements RateLimiterInterface {
    /**
     * The list of rate limiters bound to each apps that interacts.
     */
    protected rateLimiters: { [appId: string]: RateLimiterAbstract } = {
        //
    };

    /**
     * Initialize the local rate limiter driver.
     */
    constructor(protected server: Server) {
        //
    }

    /**
     * Consume the points for backend-received events.
     */
    consumeBackendEventPoints(points: number, app?: App, ws?: WebSocket<UserDataInterface>): Promise<ConsumptionResponse> {
        return this.consume(
            app,
            `${app.id}:backend:events`,
            points,
            app.maxBackendEventsPerSecond as number,
        );
    }

    /**
     * Consume the points for frontend-received events.
     */
    consumeFrontendEventPoints(points: number, app?: App, ws?: WebSocket<UserDataInterface>): Promise<ConsumptionResponse> {
        return this.consume(
            app,
            `${app.id}:frontend:events:${ws.getUserData().id}`,
            points,
            app.maxClientEventsPerSecond as number,
        );
    }

    /**
     * Consume the points for HTTP read requests.
     */
    consumeReadRequestsPoints(points: number, app?: App, ws?: WebSocket<UserDataInterface>): Promise<ConsumptionResponse> {
        return this.consume(
            app,
            `${app.id}:backend:request_read`,
            points,
            app.maxReadRequestsPerSecond as number,
        );
    }

    /**
     * Create a new rate limiter instance.
     */
    createNewRateLimiter(appId: string, maxPoints: number): RateLimiterAbstract {
        return new RateLimiterMemory({
            points: maxPoints,
            duration: 1,
            keyPrefix: `app:${appId}`,
        });
    }

    /**
     * Clear the rate limiter or active connections.
     */
    disconnect(): Promise<void> {
        return Promise.resolve();
    }

    /**
     * Initialize a new rate limiter for the given app and event key.
     */
    protected initializeRateLimiter(appId: string, eventKey: string, maxPoints: number): Promise<RateLimiterAbstract> {
        if (this.rateLimiters[`${appId}:${eventKey}`]) {
            return new Promise(resolve => {
                this.rateLimiters[`${appId}:${eventKey}`].points = maxPoints;

                resolve(this.rateLimiters[`${appId}:${eventKey}`]);
            });
        }

        this.rateLimiters[`${appId}:${eventKey}`] = this.createNewRateLimiter(appId, maxPoints);

        return Promise.resolve(this.rateLimiters[`${appId}:${eventKey}`]);
    }

    /**
     * Consume points for a given key, then
     * return a response object with headers and the success indicator.
     */
    protected consume(app: App, eventKey: string, points: number, maxPoints: number): Promise<ConsumptionResponse> {
        if (maxPoints < 0) {
            return Promise.resolve({
                canContinue: true,
                rateLimiterRes: null,
                headers: {
                    //
                },
            });
        }

        let calculateHeaders = (rateLimiterRes: RateLimiterRes) => ({
            'Retry-After': rateLimiterRes.msBeforeNext / 1000,
            'X-RateLimit-Limit': maxPoints,
            'X-RateLimit-Remaining': rateLimiterRes.remainingPoints,
        });

        return this.initializeRateLimiter(app.id, eventKey, maxPoints).then(rateLimiter => {
            return rateLimiter.consume(eventKey, points).then((rateLimiterRes: RateLimiterRes) => {
                return {
                    canContinue: true,
                    rateLimiterRes,
                    headers: calculateHeaders(rateLimiterRes),
                };
            }).catch((rateLimiterRes: RateLimiterRes) => {
                return {
                    canContinue: false,
                    rateLimiterRes,
                    headers: calculateHeaders(rateLimiterRes),
                };
            });
        });
    }
}
