import { WebSocketServer, WebSocket } from 'ws';
import type { EngineResult } from './engine.js';

export class BridgeServer {
    private wss!: WebSocketServer;
    private socket: WebSocket | null = null;
    private pending = new Map<string, (r: EngineResult) => void>();
    private _onConnect?: () => void;
    private _onDisconnect?: () => void;

    onConnect(fn: () => void)    { this._onConnect = fn; }
    onDisconnect(fn: () => void) { this._onDisconnect = fn; }
    get connected()              { return this.socket?.readyState === WebSocket.OPEN; }

    async start(port = 9876): Promise<void> {
        this.wss = new WebSocketServer({ port });
        await new Promise<void>((resolve, reject) => {
            this.wss.on('listening', resolve);
            this.wss.on('error', reject);
        });
        this.wss.on('connection', (ws) => {
            this.socket = ws;
            this._onConnect?.();
            ws.on('message', (data) => {
                const msg = JSON.parse(String(data)) as { id: string } & EngineResult;
                this.pending.get(msg.id)?.(msg);
                this.pending.delete(msg.id);
            });
            ws.on('close', () => { this.socket = null; this._onDisconnect?.(); });
        });
    }

    async run(command: string): Promise<EngineResult> {
        if (!this.connected) return { text: 'Extension not connected', isError: true };
        const id = Math.random().toString(36).slice(2);
        return new Promise((resolve) => {
            this.pending.set(id, resolve);
            this.socket!.send(JSON.stringify({ id, command }));
        });
    }

    async waitForConnection(timeoutMs = 30000): Promise<void> {
        if (this.connected) return;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error('Timed out waiting for extension to connect'));
            }, timeoutMs);
            const prev = this._onConnect;
            this._onConnect = () => {
                clearTimeout(timer);
                this._onConnect = prev;
                prev?.();
                resolve();
            };
        });
    }

    async close(): Promise<void> {
        this.socket?.close();
        await new Promise<void>(r => this.wss.close(() => r()));
    }
}
