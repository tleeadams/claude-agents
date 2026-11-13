// Opens the Claude Agents dashboard. Starts the dashboard server in the
// background when it isn't running, then brings the dashboard's window to the
// front, or opens one. Built by scripts/install-shortcut.js.

using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

static class Launcher
{
    const string AppName = "Claude Agents";
    const int Port = 4317;
    // The page sets this title, with a count in front when agents need you.
    static readonly Regex WindowTitle = new Regex(@"^(\(\d+\) )?Claude Agents$");

    delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc proc, IntPtr lParam);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int max);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd, StringBuilder name, int max);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hwnd, int cmd);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hwnd);

    [STAThread]
    static void Main()
    {
        try
        {
            string root = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, ".."));
            if (!ServerIsUp())
            {
                StartServer(root);
                if (!WaitForServer(TimeSpan.FromSeconds(20)))
                {
                    Fail("The dashboard server didn't start. Run \"npm start\" in " + root + " to see why.");
                    return;
                }
            }
            if (!FocusExistingWindow()) OpenWindow();
        }
        catch (Exception e)
        {
            Fail(e.Message);
        }
    }

    static bool ServerIsUp()
    {
        try
        {
            var request = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + Port + "/favicon.svg");
            request.Timeout = 1500;
            request.Proxy = null;
            using (var response = (HttpWebResponse)request.GetResponse())
            {
                return response.StatusCode == HttpStatusCode.OK;
            }
        }
        catch (WebException)
        {
            return false;
        }
    }

    static bool WaitForServer(TimeSpan timeout)
    {
        var watch = Stopwatch.StartNew();
        while (watch.Elapsed < timeout)
        {
            if (ServerIsUp()) return true;
            Thread.Sleep(250);
        }
        return false;
    }

    // Uses the Node that ran the installer when it still exists, otherwise
    // whichever node is on the PATH. The server stops itself once no dashboard
    // has been open for a while.
    static void StartServer(string root)
    {
        string node = "node";
        string recorded = Path.Combine(root, "launcher", "node-path.txt");
        if (File.Exists(recorded))
        {
            string path = File.ReadAllText(recorded).Trim();
            if (File.Exists(path)) node = path;
        }
        var info = new ProcessStartInfo(node, "\"" + Path.Combine(root, "server.js") + "\" --exit-when-idle")
        {
            WorkingDirectory = root,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        Process.Start(info);
    }

    static bool FocusExistingWindow()
    {
        IntPtr found = IntPtr.Zero;
        EnumWindows((hwnd, unused) =>
        {
            if (!IsWindowVisible(hwnd)) return true;
            var name = new StringBuilder(256);
            GetClassName(hwnd, name, name.Capacity);
            if (name.ToString() != "Chrome_WidgetWin_1") return true;
            var text = new StringBuilder(512);
            GetWindowText(hwnd, text, text.Capacity);
            if (!WindowTitle.IsMatch(text.ToString())) return true;
            found = hwnd;
            return false;
        }, IntPtr.Zero);
        if (found == IntPtr.Zero) return false;
        if (IsIconic(found)) ShowWindow(found, 9);
        SetForegroundWindow(found);
        return true;
    }

    // An Edge app window has no tabs or address bar, so it looks like an app.
    static void OpenWindow()
    {
        string url = "http://localhost:" + Port + "/";
        try
        {
            Process.Start(new ProcessStartInfo("msedge.exe", "--app=" + url) { UseShellExecute = true });
        }
        catch (System.ComponentModel.Win32Exception)
        {
            Process.Start(url);
        }
    }

    static void Fail(string message)
    {
        MessageBox.Show(message, AppName, MessageBoxButtons.OK, MessageBoxIcon.Warning);
    }
}
