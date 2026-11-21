// PDF Editor.exe - tiny Windows launcher so Explorer's "Open with" / Default apps can use it.
// It just runs "node launch.js <file>" from the folder the exe lives in, with no console window.
// Build: tools\build-launcher.cmd
using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

static class Program
{
    [STAThread]
    static void Main(string[] args)
    {
        string baseDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
        string launch = Path.Combine(baseDir, "launch.js");
        string node = FindNode();
        if (node == null || !File.Exists(launch))
        {
            MessageBox.Show("PDF Editor could not start.\n\n" +
                (node == null ? "Node.js was not found (node.exe)." : "launch.js is missing next to PDF Editor.exe."),
                "PDF Editor", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }
        string argLine = "\"" + launch + "\"";
        if (args.Length > 0)
        {
            argLine += " \"" + string.Join(" ", args).Trim('"') + "\"";
        }
        var psi = new ProcessStartInfo(node, argLine)
        {
            WorkingDirectory = baseDir,
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden,
        };
        try { Process.Start(psi); }
        catch (Exception ex)
        {
            MessageBox.Show("PDF Editor could not start:\n\n" + ex.Message, "PDF Editor", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    static string FindNode()
    {
        string[] candidates = {
            @"C:\Program Files\nodejs\node.exe",
            @"C:\Program Files (x86)\nodejs\node.exe",
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Programs\nodejs\node.exe"),
        };
        foreach (string c in candidates) if (File.Exists(c)) return c;
        string path = Environment.GetEnvironmentVariable("PATH") ?? "";
        foreach (string dir in path.Split(';'))
        {
            try
            {
                string p = Path.Combine(dir.Trim(), "node.exe");
                if (File.Exists(p)) return p;
            }
            catch { }
        }
        return null;
    }
}
