// Module d'intégration : place la fenêtre d'un émulateur DANS / SUR la fenêtre d'Emuglob (Win32).
// Protocole texte (une commande par ligne sur stdin, événements sur stdout) :
//   embed <pid> <hwndParent> <x> <y> <w> <h> <timeoutMs> [child|overlay]   move <x> <y> <w> <h>   focus   close   release   quit
//   (embed cache aussi, dès sa création, toute fenêtre du processus hors de l'écran jusqu'à l'intégration)
//   vol <pid> <0-100 ou -1> <muet 0|1|-1>   (volume de l'émulateur dans le mélangeur de Windows ; -1 = ne pas changer) → vol <niveau> <muet> <sessions>
// (x y w h = zone cliente d'Emuglob, en pixels physiques)
// Événements : ready | found <hwnd> | parent <info> | embedded <hwnd> | error <message> | closed
// Deux modes :
//   child   : la fenêtre devient une VRAIE fenêtre enfant (SetParent) du moteur de rendu d'Emuglob. Peut rester noire avec OpenGL / Vulkan / DirectX.
//   overlay : la fenêtre reste une fenêtre de premier niveau, sans bordure, POSSÉDÉE par Emuglob, collée sur la zone de jeu et suivie 12 fois par seconde.
//             La vidéo n'est pas touchée (compatible avec tout) et le menu natif de l'émulateur est conservé.
//             Suivi rapide (≈ 2 ms) tant qu'Emuglob bouge, lent (40 ms) au repos ; déplacements postés en asynchrone pour ne jamais attendre l'émulateur.
// Écrit en C# 5 : il est compilé sur le PC de l'utilisateur avec le csc.exe fourni par Windows (.NET Framework 4).
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

public static class EmbedHelper
{
    const int GWL_STYLE = -16;
    const int GWL_EXSTYLE = -20;
    const int GWLP_HWNDPARENT = -8;
    const uint WS_POPUP = 0x80000000;
    const uint WS_CHILD = 0x40000000;
    const uint WS_VISIBLE = 0x10000000;
    const uint WS_CLIPSIBLINGS = 0x04000000;
    const uint WS_CLIPCHILDREN = 0x02000000;
    const uint WS_CAPTION = 0x00C00000;
    const uint WS_SYSMENU = 0x00080000;
    const uint WS_THICKFRAME = 0x00040000;
    const uint WS_MINIMIZEBOX = 0x00020000;
    const uint WS_MAXIMIZEBOX = 0x00010000;
    const uint WS_OVERLAPPEDWINDOW = 0x00CF0000;
    const uint WS_EX_DLGMODALFRAME = 0x00000001;
    const uint WS_EX_TOOLWINDOW = 0x00000080;
    const uint WS_EX_WINDOWEDGE = 0x00000100;
    const uint WS_EX_CLIENTEDGE = 0x00000200;
    const uint WS_EX_STATICEDGE = 0x00020000;
    const uint WS_EX_APPWINDOW = 0x00040000;
    const uint SWP_NOSIZE = 0x0001;
    const uint SWP_NOZORDER = 0x0004;
    const uint SWP_NOACTIVATE = 0x0010;
    const uint SWP_FRAMECHANGED = 0x0020;
    const uint SWP_SHOWWINDOW = 0x0040;
    const uint SWP_ASYNCWINDOWPOS = 0x4000;
    const uint WM_CLOSE = 0x0010;
    const uint RDW_INVALIDATE = 0x0001;
    const uint RDW_FRAME = 0x0400;
    const uint RDW_ALLCHILDREN = 0x0080;
    const uint RDW_UPDATENOW = 0x0100;
    const int SW_HIDE = 0;
    const int SW_SHOWNORMAL = 1;
    const int SW_SHOWNOACTIVATE = 4;

    [StructLayout(LayoutKind.Sequential)]
    struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)]
    struct POINT { public int X, Y; }

    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
    [DllImport("user32.dll", SetLastError = true)] static extern IntPtr SetParent(IntPtr child, IntPtr parent);
    [DllImport("user32.dll")] static extern IntPtr GetParent(IntPtr hwnd);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] static extern IntPtr GetWindowLongPtr(IntPtr hwnd, int index);
    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")] static extern IntPtr SetWindowLongPtr(IntPtr hwnd, int index, IntPtr value);
    [DllImport("user32.dll", SetLastError = true)] static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hwnd, int cmd);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool SetMenu(IntPtr hwnd, IntPtr menu);
    [DllImport("user32.dll")] static extern IntPtr SetFocus(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr hwnd);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool attach);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
    [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr hwnd, ref POINT pt);
    [DllImport("user32.dll")] static extern bool RedrawWindow(IntPtr hwnd, IntPtr rect, IntPtr rgn, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string title);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    delegate void WinEventProc(IntPtr hook, uint ev, IntPtr hwnd, int idObject, int idChild, uint thread, uint time);
    [DllImport("user32.dll")] static extern IntPtr SetWinEventHook(uint evMin, uint evMax, IntPtr mod, WinEventProc proc, uint pid, uint tid, uint flags);
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
    [StructLayout(LayoutKind.Sequential)]
    struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam; public IntPtr lParam; public uint time; public POINT pt; }
    [DllImport("user32.dll")] static extern int GetMessage(out MSG msg, IntPtr hwnd, uint min, uint max);
    [DllImport("user32.dll")] static extern bool TranslateMessage(ref MSG msg);
    [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref MSG msg);
    [DllImport("winmm.dll")] static extern uint timeBeginPeriod(uint ms);

    static readonly object gate = new object();
    static IntPtr embedded = IntPtr.Zero;   // fenêtre de l'émulateur
    static IntPtr topWin = IntPtr.Zero;     // fenêtre principale d'Emuglob
    static string curMode = "child";
    static int rx, ry, rw, rh;              // zone de jeu (pixels physiques, relative à la zone cliente d'Emuglob)

    // ---------- masquage : les fenêtres de l'émulateur sont envoyées hors de l'écran dès leur création, jusqu'à l'intégration ----------
    const int OFF = -32000;
    static WinEventProc hideProc;           // gardé en champ : sinon le ramasse-miettes libère le délégué utilisé par Windows
    static int hidePid;                     // processus surveillé (0 = rien)
    static string hideName;                 // ou un processus du même nom (lanceurs qui se relancent)
    static DateTime hideSince;
    static System.Collections.Generic.Dictionary<IntPtr, RECT> hidden = new System.Collections.Generic.Dictionary<IntPtr, RECT>();

    static void StartHider()
    {
        Thread t = new Thread(delegate ()
        {
            hideProc = new WinEventProc(OnWinEvent);
            // 0x8000 CREATE … 0x800B LOCATIONCHANGE (dont SHOW 0x8002) ; hors contexte (0), on ignore nos propres événements (2)
            SetWinEventHook(0x8000, 0x800B, IntPtr.Zero, hideProc, 0, 0, 0x0002);
            MSG msg;
            while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0) { TranslateMessage(ref msg); DispatchMessage(ref msg); }
        });
        t.IsBackground = true;
        t.Start();
    }

    static void OnWinEvent(IntPtr hook, uint ev, IntPtr hwnd, int idObject, int idChild, uint thread, uint time)
    {
        if (idObject != 0 || idChild != 0 || hwnd == IntPtr.Zero) return;
        if (ev != 0x8000 && ev != 0x8002 && ev != 0x800B) return;
        int want; string name;
        lock (gate) { want = hidePid; name = hideName; }
        if (want == 0) return;
        if (GetAncestor(hwnd, 2) != hwnd) return;   // fenêtres de premier niveau seulement (GA_ROOT)
        uint pid;
        GetWindowThreadProcessId(hwnd, out pid);
        if ((int)pid != want)
        {
            if (name == null) return;
            try
            {
                Process q = Process.GetProcessById((int)pid);
                if (q.ProcessName != name || q.StartTime < hideSince.AddSeconds(-2)) return;
            }
            catch (Exception) { return; }
        }
        RECT r;
        if (!GetWindowRect(hwnd, out r) || r.Left <= OFF + 1000) return;   // déjà caché
        lock (gate) { if (hidePid == 0) return; if (!hidden.ContainsKey(hwnd)) hidden[hwnd] = r; }
        SetWindowPos(hwnd, IntPtr.Zero, OFF, OFF, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
    }

    static void HideStart(int pid)
    {
        string name = null;
        try { name = Process.GetProcessById(pid).ProcessName; } catch (Exception) { }
        lock (gate) { hidePid = pid; hideName = name; hideSince = DateTime.Now; hidden.Clear(); }
    }

    // fin du masquage ; restore = remettre les fenêtres cachées à leur place (intégration ratée : messages d'erreur, assistants…)
    static void HideStop(bool restore, IntPtr keep)
    {
        System.Collections.Generic.Dictionary<IntPtr, RECT> list;
        lock (gate) { hidePid = 0; hideName = null; list = hidden; hidden = new System.Collections.Generic.Dictionary<IntPtr, RECT>(); }
        foreach (System.Collections.Generic.KeyValuePair<IntPtr, RECT> kv in list)
        {
            if (kv.Key == keep || !IsWindow(kv.Key)) continue;
            RECT now;
            if (!restore && GetWindowRect(kv.Key, out now) && now.Left > OFF + 1000) continue;
            SetWindowPos(kv.Key, IntPtr.Zero, kv.Value.Left, kv.Value.Top, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
        }
    }

    static void Out(string s)
    {
        lock (gate) { Console.WriteLine(s); Console.Out.Flush(); }
    }

    public static void Main(string[] args)
    {
        try { SetProcessDPIAware(); } catch (Exception) { }
        try { timeBeginPeriod(1); } catch (Exception) { }   // minuteur à 1 ms : sans ça Sleep(2) dure ~15 ms sous Windows
        StartHider();
        Out("ready");
        string line;
        while ((line = Console.ReadLine()) != null)
        {
            line = line.Trim();
            if (line.Length == 0) continue;
            try { Handle(line.Split(' ')); }
            catch (Exception ex) { Out("error " + ex.Message.Replace('\n', ' ').Replace('\r', ' ')); }
        }
        Release();
    }

    static void Handle(string[] p)
    {
        switch (p[0])
        {
            case "embed":
                int pid = int.Parse(p[1]);
                IntPtr parent = new IntPtr(long.Parse(p[2]));
                int x = int.Parse(p[3]), y = int.Parse(p[4]), w = int.Parse(p[5]), h = int.Parse(p[6]);
                int timeout = p.Length > 7 ? int.Parse(p[7]) : 20000;
                string mode = p.Length > 8 && p[8] == "overlay" ? "overlay" : "child";
                HideStart(pid);   // tout de suite, avant que l'émulateur ait créé sa fenêtre
                Thread t = new Thread(delegate () { DoEmbed(pid, parent, x, y, w, h, timeout, mode); });
                t.IsBackground = true;
                t.Start();
                break;
            case "move":
                IntPtr cur;
                string m;
                lock (gate) { cur = embedded; m = curMode; rx = int.Parse(p[1]); ry = int.Parse(p[2]); rw = int.Parse(p[3]); rh = int.Parse(p[4]); }
                if (cur != IntPtr.Zero)
                {
                    if (m == "overlay") PlaceOverlay(cur, false);
                    else SetWindowPos(cur, IntPtr.Zero, rx, ry, rw, rh, SWP_NOZORDER | SWP_NOACTIVATE);
                }
                break;
            case "focus":
                Focus();
                break;
            case "close":
                IntPtr c;
                lock (gate) { c = embedded; }
                if (c != IntPtr.Zero) PostMessage(c, WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
                break;
            case "release":
                Release();
                break;
            case "vol":
                Out(Volume(int.Parse(p[1]), p.Length > 2 ? int.Parse(p[2]) : -1, p.Length > 3 ? int.Parse(p[3]) : -1));
                break;
            case "quit":
                Release();
                Environment.Exit(0);
                break;
        }
    }

    // ---------- volume par application (sessions audio Windows, Core Audio) ----------
    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorCo { }
    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceEnumerator
    {
        [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IMMDeviceCollection devices);
    }
    [ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceCollection
    {
        [PreserveSig] int GetCount(out uint count);
        [PreserveSig] int Item(uint index, out IMMDevice device);
    }
    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDevice
    {
        [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
    }
    [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionManager2
    {
        [PreserveSig] int GetAudioSessionControl(IntPtr a, int b, out IntPtr c);
        [PreserveSig] int GetSimpleAudioVolume(IntPtr a, int b, out IntPtr c);
        [PreserveSig] int GetSessionEnumerator(out IAudioSessionEnumerator sessions);
    }
    [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionEnumerator
    {
        [PreserveSig] int GetCount(out int count);
        [PreserveSig] int GetSession(int index, out IAudioSessionControl2 session);
    }
    [ComImport, Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionControl2
    {
        // IAudioSessionControl (9 méthodes, non utilisées ici : seules leurs places comptent)
        [PreserveSig] int GetState(out int state);
        [PreserveSig] int GetDisplayName(out IntPtr name);
        [PreserveSig] int SetDisplayName(IntPtr name, IntPtr ctx);
        [PreserveSig] int GetIconPath(out IntPtr path);
        [PreserveSig] int SetIconPath(IntPtr path, IntPtr ctx);
        [PreserveSig] int GetGroupingParam(out Guid g);
        [PreserveSig] int SetGroupingParam(IntPtr g, IntPtr ctx);
        [PreserveSig] int RegisterAudioSessionNotification(IntPtr n);
        [PreserveSig] int UnregisterAudioSessionNotification(IntPtr n);
        // IAudioSessionControl2
        [PreserveSig] int GetSessionIdentifier(out IntPtr id);
        [PreserveSig] int GetSessionInstanceIdentifier(out IntPtr id);
        [PreserveSig] int GetProcessId(out uint pid);
    }
    [ComImport, Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface ISimpleAudioVolume
    {
        [PreserveSig] int SetMasterVolume(float level, ref Guid ctx);
        [PreserveSig] int GetMasterVolume(out float level);
        [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid ctx);
        [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
    }

    // processus de l'émulateur : le pid lancé et ceux qui portent le même nom (certains émulateurs jouent le son dans un sous-processus)
    static System.Collections.Generic.HashSet<uint> EmuPids(int pid)
    {
        System.Collections.Generic.HashSet<uint> set = new System.Collections.Generic.HashSet<uint>();
        set.Add((uint)pid);
        try
        {
            string name = Process.GetProcessById(pid).ProcessName;
            foreach (Process q in Process.GetProcessesByName(name)) set.Add((uint)q.Id);
        }
        catch (Exception) { }
        return set;
    }

    static string Volume(int pid, int level, int mute)
    {
        System.Collections.Generic.HashSet<uint> pids = EmuPids(pid);
        Guid ctx = Guid.Empty, iidMgr = typeof(IAudioSessionManager2).GUID;
        float cur = -1; bool muted = false; int n = 0;
        IMMDeviceEnumerator en = (IMMDeviceEnumerator)new MMDeviceEnumeratorCo();
        IMMDeviceCollection devs;
        if (en.EnumAudioEndpoints(0, 1, out devs) != 0) return "vol -1 0 0";   // sorties audio actives
        uint count; devs.GetCount(out count);
        for (uint i = 0; i < count; i++)
        {
            IMMDevice dev; if (devs.Item(i, out dev) != 0) continue;
            object o; if (dev.Activate(ref iidMgr, 23, IntPtr.Zero, out o) != 0) continue;   // CLSCTX_ALL
            IAudioSessionEnumerator ses; if (((IAudioSessionManager2)o).GetSessionEnumerator(out ses) != 0) continue;
            int sc; ses.GetCount(out sc);
            for (int k = 0; k < sc; k++)
            {
                IAudioSessionControl2 c; if (ses.GetSession(k, out c) != 0 || c == null) continue;
                uint sp; if (c.GetProcessId(out sp) != 0 || !pids.Contains(sp)) continue;
                ISimpleAudioVolume v = (ISimpleAudioVolume)c;
                if (level >= 0) v.SetMasterVolume(Math.Max(0, Math.Min(100, level)) / 100f, ref ctx);
                if (mute >= 0) v.SetMute(mute == 1, ref ctx);
                v.GetMasterVolume(out cur); v.GetMute(out muted);
                n++;
            }
        }
        return "vol " + (cur < 0 ? -1 : (int)Math.Round(cur * 100)) + " " + (muted ? 1 : 0) + " " + n;
    }

    static void DoEmbed(int pid, IntPtr parent, int x, int y, int w, int h, int timeoutMs, string mode)
    {
        DateTime start = DateTime.Now;
        DateTime deadline = start.AddMilliseconds(timeoutMs);
        string name = null;
        IntPtr win = IntPtr.Zero;
        while (DateTime.Now < deadline)
        {
            win = FindWindowFor(pid, ref name, start);
            if (win != IntPtr.Zero) break;
            Thread.Sleep(30);   // recherche rapide : la fenêtre de l'émulateur ne doit pas rester visible seule à l'écran
        }
        if (win == IntPtr.Zero)
        {
            HideStop(true, IntPtr.Zero);
            Out("error aucune fenetre trouvee pour le processus " + pid + (name != null ? " (" + name + ")" : " (deja ferme ?)"));
            return;
        }
        // aussitôt trouvée, la fenêtre part hors de l'écran (elle continue de se charger) : plus de liste de jeux ni d'écran blanc visibles
        SetWindowPos(win, IntPtr.Zero, OFF, OFF, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
        Out("found " + win.ToInt64() + " mode " + mode);
        Thread.Sleep(300);   // laisse l'émulateur finir d'initialiser sa fenêtre
        lock (gate) { topWin = parent; curMode = mode; rx = x; ry = y; rw = w; rh = h; }
        HideStop(false, win);   // la fenêtre principale va être placée ; les autres (boîtes de dialogue) reviennent à l'écran
        string err = mode == "overlay" ? ApplyOverlay(win, parent) : Reparent(win, parent, x, y, w, h);
        if (err != null) { Out("error " + err); return; }
        lock (gate) { embedded = win; }
        Out("embedded " + win.ToInt64());
        Focus();
        if (mode == "child")
        {
            // force un redessin de la surface vidéo : légère variation de taille puis retour (déclenche le « resize » de l'émulateur)
            Thread.Sleep(500);
            if (IsWindow(win))
            {
                SetWindowPos(win, IntPtr.Zero, x, y, w + 1, h, SWP_NOZORDER | SWP_NOACTIVATE);
                SetWindowPos(win, IntPtr.Zero, x, y, w, h, SWP_NOZORDER | SWP_NOACTIVATE);
                RedrawWindow(win, IntPtr.Zero, IntPtr.Zero, RDW_INVALIDATE | RDW_UPDATENOW | RDW_ALLCHILDREN | RDW_FRAME);
            }
        }
        int fast = 0;
        while (IsWindow(win))
        {
            if (mode == "overlay" && TrackOverlay(win)) fast = 200;   // Emuglob vient de bouger : on reste en suivi rapide
            Thread.Sleep(fast > 0 ? 2 : (mode == "overlay" ? 40 : 500));
            if (fast > 0) fast--;
        }
        lock (gate) { if (embedded == win) embedded = IntPtr.Zero; }
        Out("closed");
    }

    // fenêtre principale du processus lancé, ou d'un processus du même nom démarré juste après (lanceurs qui se relancent)
    static IntPtr FindWindowFor(int pid, ref string name, DateTime since)
    {
        try
        {
            Process p = Process.GetProcessById(pid);
            if (name == null) name = p.ProcessName;
            p.Refresh();
            IntPtr hw = p.MainWindowHandle;
            if (Usable(hw)) return hw;
        }
        catch (Exception) { }
        if (name != null)
        {
            foreach (Process q in Process.GetProcessesByName(name))
            {
                try
                {
                    if (q.StartTime < since.AddSeconds(-2)) continue;
                    q.Refresh();
                    if (Usable(q.MainWindowHandle)) return q.MainWindowHandle;
                }
                catch (Exception) { }
            }
        }
        return IntPtr.Zero;
    }

    static bool Usable(IntPtr hw)
    {
        if (hw == IntPtr.Zero || !IsWindowVisible(hw)) return false;
        RECT r;
        if (!GetWindowRect(hw, out r)) return false;
        return (r.Right - r.Left) >= 200 && (r.Bottom - r.Top) >= 150;   // ignore les petits écrans de démarrage
    }

    // ---------- mode « child » ----------
    static string Reparent(IntPtr win, IntPtr top, int x, int y, int w, int h)
    {
        if (!IsWindow(win)) return "la fenetre a disparu";
        // le moteur de rendu de Chromium (Chrome_RenderWidgetHostHWND) occupe toute la zone cliente : un frère placé « sous » lui serait invisible.
        // En devenant son ENFANT, la fenêtre est toujours dessinée au-dessus de son contenu.
        IntPtr target = FindWindowEx(top, IntPtr.Zero, "Chrome_RenderWidgetHostHWND", null);
        Out("parent " + (target != IntPtr.Zero ? "moteur de rendu " + target.ToInt64() : "fenetre principale " + top.ToInt64()));
        if (target == IntPtr.Zero) target = top;
        ShowWindow(win, SW_SHOWNORMAL);
        SetMenu(win, IntPtr.Zero);   // une fenêtre enfant ne peut pas avoir de menu natif
        uint style = (uint)(GetWindowLongPtr(win, GWL_STYLE).ToInt64() & 0xFFFFFFFFL);
        uint ex = (uint)(GetWindowLongPtr(win, GWL_EXSTYLE).ToInt64() & 0xFFFFFFFFL);
        style = (style & ~(WS_POPUP | WS_CAPTION | WS_SYSMENU | WS_THICKFRAME | WS_MINIMIZEBOX | WS_MAXIMIZEBOX)) | WS_CHILD | WS_VISIBLE | WS_CLIPSIBLINGS | WS_CLIPCHILDREN;
        ex = ex & ~(WS_EX_DLGMODALFRAME | WS_EX_WINDOWEDGE | WS_EX_CLIENTEDGE | WS_EX_STATICEDGE | WS_EX_APPWINDOW);
        SetWindowLongPtr(win, GWL_STYLE, new IntPtr((long)style));      // style enfant AVANT SetParent (recommandation de la doc Win32)
        SetWindowLongPtr(win, GWL_EXSTYLE, new IntPtr((long)ex));
        SetParent(win, target);
        if (GetParent(win) != target) return "SetParent a echoue (code " + Marshal.GetLastWin32Error() + ")";
        SetWindowPos(win, IntPtr.Zero, x, y, w, h, SWP_FRAMECHANGED | SWP_SHOWWINDOW);   // sans SWP_NOZORDER : on veut aussi remonter la fenêtre au premier plan
        BringWindowToTop(win);
        RedrawWindow(win, IntPtr.Zero, IntPtr.Zero, RDW_INVALIDATE | RDW_UPDATENOW | RDW_ALLCHILDREN | RDW_FRAME);
        return null;
    }

    // ---------- mode « overlay » ----------
    static string ApplyOverlay(IntPtr win, IntPtr top)
    {
        if (!IsWindow(win)) return "la fenetre a disparu";
        ShowWindow(win, SW_SHOWNORMAL);
        uint style = (uint)(GetWindowLongPtr(win, GWL_STYLE).ToInt64() & 0xFFFFFFFFL);
        uint ex = (uint)(GetWindowLongPtr(win, GWL_EXSTYLE).ToInt64() & 0xFFFFFFFFL);
        // plus de cadre ni de barre de titre, mais on GARDE le menu natif (connexion RetroAchievements de RALibretro, par exemple)
        style = (style & ~(WS_CAPTION | WS_SYSMENU | WS_THICKFRAME | WS_MINIMIZEBOX | WS_MAXIMIZEBOX | WS_CHILD)) | WS_POPUP | WS_VISIBLE | WS_CLIPSIBLINGS | WS_CLIPCHILDREN;
        ex = (ex & ~(WS_EX_DLGMODALFRAME | WS_EX_WINDOWEDGE | WS_EX_CLIENTEDGE | WS_EX_STATICEDGE | WS_EX_APPWINDOW)) | WS_EX_TOOLWINDOW;   // pas de 2e icône dans la barre des tâches
        SetWindowLongPtr(win, GWL_STYLE, new IntPtr((long)style));
        SetWindowLongPtr(win, GWL_EXSTYLE, new IntPtr((long)ex));
        SetWindowLongPtr(win, GWLP_HWNDPARENT, top);   // « propriétaire » : la fenêtre reste au-dessus d'Emuglob et suit sa pile de fenêtres
        Out("parent proprietaire " + top.ToInt64());
        PlaceOverlay(win, true);
        return null;
    }

    static void PlaceOverlay(IntPtr win, bool frame)
    {
        IntPtr top; int x, y, w, h;
        lock (gate) { top = topWin; x = rx; y = ry; w = rw; h = rh; }
        POINT p; p.X = x; p.Y = y;
        ClientToScreen(top, ref p);
        SetWindowPos(win, IntPtr.Zero, p.X, p.Y, w, h, SWP_SHOWWINDOW | SWP_NOACTIVATE | (frame ? SWP_FRAMECHANGED : 0));
    }

    // garde la fenêtre collée sur la zone de jeu (déplacement / redimensionnement d'Emuglob, réduction, retour)
    // retourne true si la fenêtre a dû être déplacée (pour passer en suivi rapide)
    static bool TrackOverlay(IntPtr win)
    {
        IntPtr top; int x, y, w, h;
        lock (gate) { top = topWin; x = rx; y = ry; w = rw; h = rh; }
        if (!IsWindow(top)) return false;
        if (IsIconic(top) || !IsWindowVisible(top))
        {
            if (IsWindowVisible(win)) ShowWindow(win, SW_HIDE);
            return false;
        }
        if (!IsWindowVisible(win)) ShowWindow(win, SW_SHOWNOACTIVATE);
        POINT p; p.X = x; p.Y = y;
        ClientToScreen(top, ref p);
        RECT r;
        if (!GetWindowRect(win, out r)) return false;
        if (r.Left == p.X && r.Top == p.Y && (r.Right - r.Left) == w && (r.Bottom - r.Top) == h) return false;
        // ASYNCWINDOWPOS : la demande est postée au thread de l'émulateur, on n'attend pas qu'il ait fini de dessiner son image
        SetWindowPos(win, IntPtr.Zero, p.X, p.Y, w, h, SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_ASYNCWINDOWPOS);
        return true;
    }

    static void Focus()
    {
        IntPtr win; string m;
        lock (gate) { win = embedded; m = curMode; }
        if (win == IntPtr.Zero) return;
        uint pid;
        uint tid = GetWindowThreadProcessId(win, out pid);
        uint me = GetCurrentThreadId();
        if (m == "overlay")
        {
            uint fpid;
            uint ftid = GetWindowThreadProcessId(GetForegroundWindow(), out fpid);
            AttachThreadInput(me, ftid, true);
            SetForegroundWindow(win);
            AttachThreadInput(me, ftid, false);
            return;
        }
        AttachThreadInput(me, tid, true);
        SetFocus(win);
        AttachThreadInput(me, tid, false);
    }

    static void Release()
    {
        IntPtr win;
        lock (gate) { win = embedded; embedded = IntPtr.Zero; }
        if (win == IntPtr.Zero || !IsWindow(win)) return;
        uint style = (uint)(GetWindowLongPtr(win, GWL_STYLE).ToInt64() & 0xFFFFFFFFL);
        style = (style & ~WS_CHILD & ~WS_POPUP) | WS_OVERLAPPEDWINDOW | WS_VISIBLE;
        SetWindowLongPtr(win, GWLP_HWNDPARENT, IntPtr.Zero);
        SetParent(win, IntPtr.Zero);
        SetWindowLongPtr(win, GWL_STYLE, new IntPtr((long)style));
        SetWindowPos(win, IntPtr.Zero, 100, 100, 1024, 768, SWP_NOZORDER | SWP_FRAMECHANGED | SWP_SHOWWINDOW);
    }
}
