import type { WebSocket } from 'ws'

class WsClientStore {
  private clients = new Map<string, Set<WebSocket>>()

  add(userId: string, socket: WebSocket): void {
    if (!this.clients.has(userId)) {
      this.clients.set(userId, new Set())
    }
    this.clients.get(userId)!.add(socket)
  }

  remove(userId: string, socket: WebSocket): void {
    this.clients.get(userId)?.delete(socket)
  }

  broadcast(userId: string, data: unknown): void {
    const sockets = this.clients.get(userId)
    if (!sockets) return
    const msg = JSON.stringify(data)
    for (const socket of sockets) {
      if (socket.readyState === socket.OPEN) {
        socket.send(msg)
      }
    }
  }
}

export const wsClients = new WsClientStore()
