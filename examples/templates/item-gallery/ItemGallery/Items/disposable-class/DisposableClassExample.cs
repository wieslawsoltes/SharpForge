using System;

namespace ItemGallery
{
    public class DisposableClassExample : IDisposable
    {
        public bool IsDisposed { get; private set; }
        public void Dispose()
        {
            IsDisposed = true;
        }
    }
}
