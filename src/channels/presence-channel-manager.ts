import { JoinResponse, LeaveResponse } from './public-channel-manager';
import { Log } from '../log';
import { PrivateChannelManager } from './private-channel-manager';
import { PusherMessage } from '../message';
import { UserDataInterface } from '../adapters/user-data-interface';
import { Utils } from '../utils';
import { WebSocket } from 'uWebSockets.js';

export interface PresenceMemberInfo {
    [key: string]: any;
}

export interface PresenceMember {
    user_id: number|string;
    user_info: PresenceMemberInfo;
    socket_id?: string;
}

export class PresenceChannelManager extends PrivateChannelManager {
    /**
     * Join the connection to the channel.
     */
    join(ws: WebSocket<UserDataInterface>, channel: string, message?: PusherMessage): Promise<JoinResponse> {
        return this.server.adapter.getChannelMembersCount(ws.getUserData().app.id, channel).then(membersCount => {
            if (membersCount + 1 > ws.getUserData().app.maxPresenceMembersPerChannel) {
                return {
                    success: false,
                    ws,
                    errorCode: 4100,
                    errorMessage: 'The maximum members per presence channel limit was reached',
                    type: 'LimitReached',
                };
            }

            let member: PresenceMember = JSON.parse(message.data.channel_data);

            let memberSizeInKb = Utils.dataToKilobytes(member.user_info);

            if (memberSizeInKb > ws.getUserData().app.maxPresenceMemberSizeInKb) {
                return {
                    success: false,
                    ws,
                    errorCode: 4301,
                    errorMessage: `The maximum size for a channel member is ${ws.getUserData().app.maxPresenceMemberSizeInKb} KB.`,
                    type: 'LimitReached',
                };
            }

            return super.join(ws, channel, message).then(response => {
                // Make sure to forward the response in case an error occurs.
                if (!response.success) {
                    return response;
                }

                return {
                    ...response,
                    ...{
                        member,
                    },
                };
            });
        }).catch(err => {
            Log.error(err);
            return {
                success: false,
                ws,
                errorCode: 4302,
                errorMessage: 'A server error has occured.',
                type: 'ServerError',
            };
        });
    }

    /**
     * Mark the connection as closed and unsubscribe it.
     */
    leave(ws: WebSocket<UserDataInterface>, channel: string): Promise<LeaveResponse> {
        return super.leave(ws, channel).then(response => {
            return {
                ...response,
                ...{
                    member: ws.getUserData().presence.get(channel),
                },
            };
        });
    }

    /**
     * Get the data to sign for the token for specific channel.
     */
    protected getDataToSignForSignature(socketId: string, message: PusherMessage): string {
        return `${socketId}:${message.data.channel}:${message.data.channel_data}`;
    }
}
