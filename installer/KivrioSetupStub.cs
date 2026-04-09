using System;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Windows.Forms;

namespace KivrioInstaller
{
    internal static class Program
    {
        private static readonly byte[] PayloadMagic = new byte[] { 0x4B, 0x49, 0x56, 0x50, 0x41, 0x59, 0x4C, 0x31 };
        private const int FooterSize = 16;

        [STAThread]
        private static int Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            try
            {
                string exePath = Application.ExecutablePath;
                string extractRoot = Path.Combine(Path.GetTempPath(), "KV");
                string zipPath = Path.Combine(extractRoot, "kivrio-package.zip");
                string installDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Kivrio");
                string startMenuDir = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                    @"Microsoft\Windows\Start Menu\Programs\Kivrio"
                );

                TryDeleteDirectory(extractRoot);
                Directory.CreateDirectory(extractRoot);
                Directory.CreateDirectory(installDir);
                Directory.CreateDirectory(startMenuDir);

                ExtractPayload(exePath, zipPath);
                ZipFile.ExtractToDirectory(zipPath, extractRoot);

                string packageRoot = Path.Combine(extractRoot, "app");
                if (!Directory.Exists(packageRoot))
                {
                    throw new InvalidOperationException("Le package Kivrio est invalide: dossier app introuvable.");
                }

                CopyDirectory(packageRoot, installDir);
                Directory.CreateDirectory(Path.Combine(installDir, "data"));
                Directory.CreateDirectory(Path.Combine(installDir, "data", "uploads"));

                string iconPath = Path.Combine(installDir, "assets", "kivrio.ico");
                if (!File.Exists(iconPath))
                {
                    throw new InvalidOperationException("Icone Kivrio introuvable apres installation.");
                }

                string desktopShortcut = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
                    "Kivrio.lnk"
                );
                string startMenuShortcut = Path.Combine(startMenuDir, "Kivrio.lnk");
                CreateShortcut(desktopShortcut, installDir, iconPath);
                CreateShortcut(startMenuShortcut, installDir, iconPath);

                string launcher = Path.Combine(installDir, "start-kivro-hidden.vbs");
                System.Diagnostics.Process.Start(
                    new System.Diagnostics.ProcessStartInfo
                    {
                        FileName = Path.Combine(Environment.SystemDirectory, "wscript.exe"),
                        Arguments = "\"" + launcher + "\"",
                        UseShellExecute = true,
                        WorkingDirectory = installDir,
                    }
                );

                TryDeleteDirectory(extractRoot);
                MessageBox.Show(
                    "Kivrio a ete installe dans AppData\\Local\\Kivrio et un raccourci Bureau a ete cree.",
                    "Installation Kivrio",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information
                );
                return 0;
            }
            catch (Exception ex)
            {
                string errorPath = Path.Combine(Path.GetTempPath(), "kivrio-installer-error.txt");
                try
                {
                    File.WriteAllText(errorPath, ex.ToString());
                }
                catch
                {
                }

                MessageBox.Show(
                    ex.Message + Environment.NewLine + Environment.NewLine + "Details: " + errorPath,
                    "Installation Kivrio impossible",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
                return 1;
            }
        }

        private static void ExtractPayload(string exePath, string destinationZip)
        {
            using (var stream = new FileStream(exePath, FileMode.Open, FileAccess.Read, FileShare.Read))
            {
                if (stream.Length <= FooterSize)
                {
                    throw new InvalidOperationException("Payload Kivrio introuvable dans l'installeur.");
                }

                stream.Seek(-FooterSize, SeekOrigin.End);
                byte[] footer = new byte[FooterSize];
                stream.Read(footer, 0, footer.Length);

                byte[] magic = footer.Take(8).ToArray();
                if (!magic.SequenceEqual(PayloadMagic))
                {
                    throw new InvalidOperationException("Signature du package Kivrio invalide.");
                }

                long payloadLength = BitConverter.ToInt64(footer, 8);
                long payloadStart = stream.Length - FooterSize - payloadLength;
                if (payloadLength <= 0 || payloadStart < 0)
                {
                    throw new InvalidOperationException("Longueur du package Kivrio invalide.");
                }

                stream.Seek(payloadStart, SeekOrigin.Begin);
                using (var output = new FileStream(destinationZip, FileMode.Create, FileAccess.Write, FileShare.None))
                {
                    byte[] buffer = new byte[4 * 1024 * 1024];
                    long remaining = payloadLength;
                    while (remaining > 0)
                    {
                        int read = stream.Read(buffer, 0, (int)Math.Min(buffer.Length, remaining));
                        if (read <= 0)
                        {
                            throw new EndOfStreamException("Lecture incomplete du package Kivrio.");
                        }

                        output.Write(buffer, 0, read);
                        remaining -= read;
                    }
                }
            }
        }

        private static void CopyDirectory(string sourceDir, string destinationDir)
        {
            foreach (string directory in Directory.GetDirectories(sourceDir, "*", SearchOption.AllDirectories))
            {
                string relative = directory.Substring(sourceDir.Length).TrimStart(Path.DirectorySeparatorChar);
                Directory.CreateDirectory(Path.Combine(destinationDir, relative));
            }

            foreach (string file in Directory.GetFiles(sourceDir, "*", SearchOption.AllDirectories))
            {
                string relative = file.Substring(sourceDir.Length).TrimStart(Path.DirectorySeparatorChar);
                string destination = Path.Combine(destinationDir, relative);
                string parent = Path.GetDirectoryName(destination);
                if (!string.IsNullOrEmpty(parent))
                {
                    Directory.CreateDirectory(parent);
                }
                File.Copy(file, destination, true);
            }
        }

        private static void CreateShortcut(string shortcutPath, string installDir, string iconPath)
        {
            Type shellType = Type.GetTypeFromProgID("WScript.Shell");
            dynamic shell = Activator.CreateInstance(shellType);
            dynamic shortcut = shell.CreateShortcut(shortcutPath);
            shortcut.TargetPath = Path.Combine(Environment.SystemDirectory, "wscript.exe");
            shortcut.Arguments = "\"" + Path.Combine(installDir, "start-kivro-hidden.vbs") + "\"";
            shortcut.WorkingDirectory = installDir;
            shortcut.IconLocation = iconPath;
            shortcut.Save();
        }

        private static void TryDeleteDirectory(string path)
        {
            try
            {
                if (Directory.Exists(path))
                {
                    Directory.Delete(path, true);
                }
            }
            catch
            {
            }
        }
    }
}
