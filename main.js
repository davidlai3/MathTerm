const { app, BrowserWindow, ipcMain } = require('electron');
const pty = require('node-pty');
const path = require('path');

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 900,
    height: 600,
    backgroundColor: '#1e1e1e',
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });

  const shell = pty.spawn(process.env.SHELL || '/bin/zsh', ['-l'], {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: process.env.HOME,
    env: {
      ...process.env,
      MATHTERM: '1',
      PATH: `${path.join(__dirname, 'bin')}:${process.env.PATH}`,
    },
  });

  shell.onData((d) => win.webContents.send('pty', d));
  shell.onExit(() => app.quit());
  ipcMain.on('input', (_, d) => shell.write(d));
  ipcMain.on('resize', (_, cols, rows) => shell.resize(cols, rows));

  // dev hooks: MATHTERM_INIT types a command at startup, MATHTERM_SHOT saves a screenshot and quits
  const { MATHTERM_INIT, MATHTERM_SHOT } = process.env;
  if (MATHTERM_INIT) setTimeout(() => shell.write(MATHTERM_INIT + '\r'), 1500);
  if (MATHTERM_SHOT) setTimeout(async () => {
    require('fs').writeFileSync(MATHTERM_SHOT, (await win.webContents.capturePage()).toPNG());
    app.quit();
  }, 4000);

  win.loadFile('index.html');
});

app.on('window-all-closed', () => app.quit());
