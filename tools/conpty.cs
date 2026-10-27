// .NET Framework 4.x, no packages. JSON-lines wire format shared with ptybridge.py.
using System;
using System.IO;
using System.Text;
using System.Threading;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;
using System.Collections.Generic;
using Microsoft.Win32.SafeHandles;
class ConPty {
 [StructLayout(LayoutKind.Sequential)] struct Coord { public short X,Y; public Coord(short x,short y){X=x;Y=y;} }
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct Startup { public int cb; public string reserved,desktop,title; public int x,y,xs,ys,xc,yc,fill,flags; public short show,cb2; public IntPtr reserved2,input,output,error; }
 [StructLayout(LayoutKind.Sequential)] struct StartupEx { public Startup info; public IntPtr attributes; }
 [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr process,thread; public int pid,tid; }
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool CreatePipe(out IntPtr read,out IntPtr write,IntPtr security,int size);
 [DllImport("kernel32.dll")] static extern int CreatePseudoConsole(Coord size,IntPtr input,IntPtr output,uint flags,out IntPtr console);
 [DllImport("kernel32.dll")] static extern int ResizePseudoConsole(IntPtr console,Coord size);
 [DllImport("kernel32.dll")] static extern void ClosePseudoConsole(IntPtr console);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr list,int count,int flags,ref IntPtr size);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr list,uint flags,IntPtr attribute,IntPtr value,IntPtr size,IntPtr previous,IntPtr returned);
 [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcess(string app,StringBuilder command,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr env,string cwd,ref StartupEx startup,out ProcessInfo process);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
 [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle,uint timeout);
 [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr handle,uint code);
 [StructLayout(LayoutKind.Sequential)] struct BasicLimit { public long processTime,jobTime; public uint flags; public UIntPtr min,max; public uint active; public UIntPtr affinity; public uint priority,scheduling; }
 [StructLayout(LayoutKind.Sequential)] struct IoCounters { public ulong a,b,c,d,e,f; }
 [StructLayout(LayoutKind.Sequential)] struct ExtendedLimit { public BasicLimit basic; public IoCounters io; public UIntPtr processMemory,jobMemory,peakProcess,peakJob; }
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr attributes,string name);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int info,ref ExtendedLimit limits,uint length);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
 [DllImport("kernel32.dll")] static extern uint ResumeThread(IntPtr thread);
 static string Quote(string s) { var b=new StringBuilder("\""); int slashes=0; foreach(char c in s){ if(c=='\\'){slashes++;continue;} if(c=='"'){b.Append('\\',slashes*2+1);b.Append(c);}else{b.Append('\\',slashes);b.Append(c);} slashes=0;} b.Append('\\',slashes*2);return b.Append('"').ToString(); }
 static void Check(bool ok){if(!ok)throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());}
 static int Main(string[] args) {
  if(args.Length==0)return 2;
  IntPtr ir=IntPtr.Zero,iw=IntPtr.Zero,or=IntPtr.Zero,ow=IntPtr.Zero,hpc=IntPtr.Zero,list=IntPtr.Zero,job=IntPtr.Zero; ProcessInfo pi=new ProcessInfo();
  try {
   Check(CreatePipe(out ir,out iw,IntPtr.Zero,0)); Check(CreatePipe(out or,out ow,IntPtr.Zero,0));
   int hr=CreatePseudoConsole(new Coord(120,40),ir,ow,0,out hpc); if(hr!=0)Marshal.ThrowExceptionForHR(hr);
   CloseHandle(ir);ir=IntPtr.Zero;CloseHandle(ow);ow=IntPtr.Zero;
   IntPtr size=IntPtr.Zero;InitializeProcThreadAttributeList(IntPtr.Zero,1,0,ref size);list=Marshal.AllocHGlobal(size);Check(InitializeProcThreadAttributeList(list,1,0,ref size));
   Check(UpdateProcThreadAttribute(list,0,new IntPtr(0x00020016),hpc,new IntPtr(IntPtr.Size),IntPtr.Zero,IntPtr.Zero));
   var si=new StartupEx();si.info.cb=Marshal.SizeOf(typeof(StartupEx));si.attributes=list;
   var cmd=new StringBuilder();foreach(string a in args){if(cmd.Length>0)cmd.Append(' ');cmd.Append(Quote(a));}
   Check(CreateProcess(args[0],cmd,IntPtr.Zero,IntPtr.Zero,false,0x00080004,IntPtr.Zero,null,ref si,out pi));
   job=CreateJobObject(IntPtr.Zero,null);Check(job!=IntPtr.Zero);var limits=new ExtendedLimit();limits.basic.flags=0x2000;Check(SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(ExtendedLimit))));Check(AssignProcessToJobObject(job,pi.process));ResumeThread(pi.thread);
   var input=new FileStream(new SafeFileHandle(iw,true),FileAccess.Write);iw=IntPtr.Zero;
   var output=new FileStream(new SafeFileHandle(or,true),FileAccess.Read);or=IntPtr.Zero;
   var reader=new Thread(delegate(){try{var buffer=new byte[16384];int n;while((n=output.Read(buffer,0,buffer.Length))>0)Console.WriteLine("{\"t\":\"o\",\"d\":\""+Convert.ToBase64String(buffer,0,n)+"\"}");}catch(IOException){}});reader.IsBackground=true;reader.Start();
   var writer=new Thread(delegate(){try{string line;var json=new JavaScriptSerializer();while((line=Console.ReadLine())!=null){if(line.Length>140000)break;var m=json.Deserialize<Dictionary<string,object>>(line);string t=(string)m["t"];if(t=="i"){byte[] b=Convert.FromBase64String((string)m["d"]);input.Write(b,0,b.Length);input.Flush();}else if(t=="r"){int c=Convert.ToInt32(m["c"]),r=Convert.ToInt32(m["r"]);if(c>=1&&c<=1000&&r>=1&&r<=1000)ResizePseudoConsole(hpc,new Coord((short)c,(short)r));}}}catch{}finally{TerminateProcess(pi.process,0);}});writer.IsBackground=true;writer.Start();
   WaitForSingleObject(pi.process,0xffffffff);ClosePseudoConsole(hpc);hpc=IntPtr.Zero;reader.Join(2000);input.Dispose();output.Dispose();return 0;
  }catch(Exception e){Console.Error.WriteLine(e.Message);return 1;}
  finally{if(job!=IntPtr.Zero)CloseHandle(job);if(pi.process!=IntPtr.Zero){TerminateProcess(pi.process,0);CloseHandle(pi.process);}if(pi.thread!=IntPtr.Zero)CloseHandle(pi.thread);if(hpc!=IntPtr.Zero)ClosePseudoConsole(hpc);if(list!=IntPtr.Zero){DeleteProcThreadAttributeList(list);Marshal.FreeHGlobal(list);}foreach(IntPtr h in new[]{ir,iw,or,ow})if(h!=IntPtr.Zero)CloseHandle(h);}
 }
}
