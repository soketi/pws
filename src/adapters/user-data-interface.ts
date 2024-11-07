import { App } from "../app";

export interface UserDataInterface {
    app: App,
    appKey: string,
    code: number,
    id: string,
    ip: string,
    ip2: string,
    presence: any,
    sendJson: Function
    subscribedChannels: Set<any>,
    timeout: NodeJS.Timeout,
    user: any,
    userAuthenticationTimeout: NodeJS.Timeout,
}
