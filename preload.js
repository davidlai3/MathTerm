const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pty', {
  write: (d) => ipcRenderer.send('input', d),
  resize: (cols, rows) => ipcRenderer.send('resize', cols, rows),
  onData: (f) => ipcRenderer.on('pty', (_, d) => f(d)),
});
