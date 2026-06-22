const { contextBridge, ipcRenderer } = require('electron')

function normalizePoint(point) {
  return {
    screenX: Number(point?.screenX),
    screenY: Number(point?.screenY),
  }
}

contextBridge.exposeInMainWorld('kiteWindow', {
  desktopToken: process.env.KITE_DESKTOP_ACCESS_TOKEN || '',
  startDrag(point) {
    ipcRenderer.send('kite-window:start-drag', normalizePoint(point))
  },
  dragTo(point) {
    ipcRenderer.send('kite-window:drag-to', normalizePoint(point))
  },
  endDrag() {
    ipcRenderer.send('kite-window:end-drag')
  },
  toggleMaximize() {
    return ipcRenderer.invoke('kite-window:toggle-maximize')
  },
})
