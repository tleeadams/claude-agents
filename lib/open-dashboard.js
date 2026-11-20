'use strict';

// Opens the dashboard. On macOS and Linux, a Chromium-based browser can show it
// as an app window, with no tabs or address bar, as the Windows launcher does
// with Edge; otherwise it opens in the default browser.

const fs = require('fs');
const { spawn } = require('child_process');

const MAC_BROWSERS = ['Google Chrome', 'Microsoft Edge', 'Brave Browser', 'Chromium', 'Vivaldi'];
const LINUX_BROWSERS = ['google-chrome', 'google-chrome-stable', 'microsoft-edge', 'microsoft-edge-stable', 'brave-browser', 'chromium', 'chromium-browser', 'vivaldi'];

function detached(cmd, args) {
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
}

const onPath = (cmd) =>
  (process.env.PATH || '').split(':').some((dir) => {
    try {
      fs.accessSync(`${dir}/${cmd}`, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });

function openDashboard(url) {
  if (process.platform === 'win32') return detached('cmd.exe', ['/c', 'start', '', url]);
  if (process.platform === 'darwin') {
    const app = MAC_BROWSERS.find((name) => fs.existsSync(`/Applications/${name}.app`));
    return app ? detached('open', ['-na', app, '--args', `--app=${url}`]) : detached('open', [url]);
  }
  const browser = LINUX_BROWSERS.find(onPath);
  return browser ? detached(browser, [`--app=${url}`]) : detached('xdg-open', [url]);
}

module.exports = { openDashboard };
