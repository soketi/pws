import { PresenceMember } from '../channels/presence-channel-manager';
import { PusherMessage } from '../message';
import { Server } from '../server';
import { UserDataInterface } from '../adapters/user-data-interface';
import { Utils } from '../utils';
import { WebSocket } from 'uWebSockets.js';

export interface JoinResponse {
    ws: WebSocket<UserDataInterface>;
    success: boolean;
    channelConnections?: number;
    authError?: boolean;
    member?: PresenceMember;
    errorMessage?: string;
    errorCode?: number;
    type?: string;
}

export interface LeaveResponse {
    left: boolean;
    remainingConnections?: number;
    member?: PresenceMember;
}

export class PublicChannelManager {
    constructor(protected server: Server) {
        //
    }

    /**
     * Join the connection to the channel.
     */
    join(ws: WebSocket<UserDataInterface>, channel: string, message?: PusherMessage): Promise<JoinResponse> {
        if (Utils.restrictedChannelName(channel)) {
            return Promise.resolve({
                ws,
                success: false,
                errorCode: 4009,
                errorMessage: 'The channel name is not allowed. Read channel conventions: https://pusher.com/docs/channels/using_channels/channels/#channel-naming-conventions',
            });
        }

        if (!ws.getUserData().app) {
            return Promise.resolve({
                ws,
                success: false,
                errorCode: 4009,
                errorMessage: 'Subscriptions messages should be sent after the pusher:connection_established event is received.',
            });
        }

        return this.server.adapter.addToChannel(ws.getUserData().app.id, channel, ws).then(connections => {
            return {
                ws,
                success: true,
                channelConnections: connections,
            };
        });
    }

    /**
     * Mark the connection as closed and unsubscribe it.
     */
    leave(ws: WebSocket<UserDataInterface>, channel: string): Promise<LeaveResponse> {
        return this.server.adapter.removeFromChannel(ws.getUserData().app.id, channel, ws.getUserData().id).then((remainingConnections) => {
            return {
                left: true,
                remainingConnections: remainingConnections as number,
            };
        });
    }
}
