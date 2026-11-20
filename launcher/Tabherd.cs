// Opens the Tabherd dashboard. Starts the dashboard server in the
// background when it isn't running, then brings the dashboard's window to the
// front, or opens one. --install adds Desktop and Start menu shortcuts to this
// program, and --uninstall removes them. Built by scripts/launcher.js.

using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

static class Launcher
{
    const string AppName = "Tabherd";
    const string ShortcutName = "Tabherd.lnk";
    // The shortcuts' name before the project was renamed, removed in their place.
    const string OldShortcutName = "Claude Agents.lnk";
    const int Port = 4317;
    // The page sets this title, with a count in front when agents need you.
    static readonly Regex WindowTitle = new Regex(@"^(\(\d+\) )?Tabherd$");

    delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc proc, IntPtr lParam);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int max);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd, StringBuilder name, int max);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hwnd, int cmd);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hwnd);

    [STAThread]
    static void Main(string[] args)
    {
        try
        {
            bool quiet = Array.IndexOf(args, "--quiet") >= 0;
            if (Array.IndexOf(args, "--install") >= 0)
            {
                string made = string.Join("\n", Shortcuts(true));
                if (!quiet) Tell("Added shortcuts:\n" + made);
                return;
            }
            if (Array.IndexOf(args, "--uninstall") >= 0)
            {
                string removed = string.Join("\n", Shortcuts(false));
                if (!quiet) Tell(removed.Length > 0 ? "Removed shortcuts:\n" + removed : "There were no shortcuts to remove.");
                return;
            }

            string root = AppRoot();
            if (!ServerIsUp())
            {
                string node = FindNode(root);
                try
                {
                    StartServer(node, root);
                }
                catch (Win32Exception)
                {
                    Fail("Tabherd needs Node.js 18 or later, and couldn't find it. Install it from nodejs.org, or download a release of Tabherd that includes it.");
                    return;
                }
                if (!WaitForServer(TimeSpan.FromSeconds(20)))
                {
                    Fail("The dashboard server didn't start. To see why, run this in a terminal:\n\n\"" + node + "\" \"" + Path.Combine(root, "server.js") + "\"");
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

    // In a release, this program sits beside server.js. Built from the
    // source, it's in launcher\, one folder down.
    static string AppRoot()
    {
        string here = AppDomain.CurrentDomain.BaseDirectory;
        if (File.Exists(Path.Combine(here, "server.js"))) return here;
        return Path.GetFullPath(Path.Combine(here, ".."));
    }

    // The Node bundled with a release, else the Node that built this
    // launcher, else whichever node is on the PATH.
    static string FindNode(string root)
    {
        string bundled = Path.Combine(root, "node", "node.exe");
        if (File.Exists(bundled)) return bundled;
        string recorded = Path.Combine(root, "launcher", "node-path.txt");
        if (File.Exists(recorded))
        {
            string path = File.ReadAllText(recorded).Trim();
            if (File.Exists(path)) return path;
        }
        return "node";
    }

    // Creates or removes "Tabherd" on the Desktop and in the Start menu,
    // returning the files it changed. Either way, shortcuts with the old name
    // go. WScript.Shell is late-bound, so no interop assembly is needed.
    static string[] Shortcuts(bool create)
    {
        string exe = Assembly.GetExecutingAssembly().Location;
        var changed = new System.Collections.Generic.List<string>();
        Type shellType = Type.GetTypeFromProgID("WScript.Shell");
        object shell = create ? Activator.CreateInstance(shellType) : null;
        foreach (var folder in new[] { Environment.SpecialFolder.DesktopDirectory, Environment.SpecialFolder.Programs })
        {
            string old = Path.Combine(Environment.GetFolderPath(folder), OldShortcutName);
            if (File.Exists(old))
            {
                File.Delete(old);
                changed.Add(old + " (old name)");
            }
            string file = Path.Combine(Environment.GetFolderPath(folder), ShortcutName);
            if (!create)
            {
                if (!File.Exists(file)) continue;
                File.Delete(file);
                changed.Add(file);
                continue;
            }
            object link = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { file });
            Type linkType = link.GetType();
            linkType.InvokeMember("TargetPath", BindingFlags.SetProperty, null, link, new object[] { exe });
            linkType.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, link, new object[] { Path.GetDirectoryName(exe) });
            linkType.InvokeMember("IconLocation", BindingFlags.SetProperty, null, link, new object[] { exe + ",0" });
            linkType.InvokeMember("Description", BindingFlags.SetProperty, null, link, new object[] { "See every running Claude Code session" });
            linkType.InvokeMember("Save", BindingFlags.InvokeMethod, null, link, null);
            changed.Add(file);
        }
        return changed.ToArray();
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

    // The server stops itself once no dashboard has been open for a while.
    static void StartServer(string node, string root)
    {
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

    static void Tell(string message)
    {
        MessageBox.Show(message, AppName, MessageBoxButtons.OK, MessageBoxIcon.Information);
    }
}
