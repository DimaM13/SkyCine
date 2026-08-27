using System;
using System.Diagnostics;
using System.Runtime.InteropServices;

namespace ProcessThrottle
{
    class Program
    {
        [DllImport("ntdll.dll", SetLastError = true)]
        private static extern int NtSuspendProcess(IntPtr processHandle);

        [DllImport("ntdll.dll", SetLastError = true)]
        private static extern int NtResumeProcess(IntPtr processHandle);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern IntPtr OpenProcess(uint processAccess, bool bInheritHandle, int processId);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool CloseHandle(IntPtr hObject);

        private const uint PROCESS_SUSPEND_RESUME = 0x0800;
        private const uint PROCESS_QUERY_INFORMATION = 0x0400;

        static int Main(string[] args)
        {
            if (args.Length < 2) return 1;
            string command = args[0].ToLowerInvariant();
            int pid;
            if (!int.TryParse(args[1], out pid) || pid <= 0) return 2;

            try
            {
                if (command == "suspend")
                {
                    IntPtr hProcess = OpenProcess(PROCESS_SUSPEND_RESUME | PROCESS_QUERY_INFORMATION, false, pid);
                    if (hProcess == IntPtr.Zero) return 3;
                    try
                    {
                        return NtSuspendProcess(hProcess) == 0 ? 0 : 4;
                    }
                    finally
                    {
                        CloseHandle(hProcess);
                    }
                }
                else if (command == "resume")
                {
                    IntPtr hProcess = OpenProcess(PROCESS_SUSPEND_RESUME | PROCESS_QUERY_INFORMATION, false, pid);
                    if (hProcess == IntPtr.Zero) return 3;
                    try
                    {
                        return NtResumeProcess(hProcess) == 0 ? 0 : 4;
                    }
                    finally
                    {
                        CloseHandle(hProcess);
                    }
                }
                else if (command == "kill")
                {
                    IntPtr hProcess = OpenProcess(PROCESS_SUSPEND_RESUME, false, pid);
                    if (hProcess != IntPtr.Zero)
                    {
                        try { NtResumeProcess(hProcess); } catch { }
                        CloseHandle(hProcess);
                    }

                    try
                    {
                        Process proc = Process.GetProcessById(pid);
                        proc.Kill();
                        return 0;
                    }
                    catch
                    {
                        return 0;
                    }
                }
                return 5;
            }
            catch
            {
                return 6;
            }
        }
    }
}
