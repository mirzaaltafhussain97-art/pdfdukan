/* PDFdukan Unlock PDF worker: runs qpdf (WebAssembly) off the main thread. */
/* qpdf is Apache-2.0 licensed: https://github.com/qpdf/qpdf */
var ready = null, err = [];
function load() {
  if (!ready) {
    importScripts('../lib/qpdf/qpdf.js?v=0.3.0');
    ready = Module({
      locateFile: function () { return '../lib/qpdf/qpdf.wasm?v=0.3.0'; },
      print: function () {},
      printErr: function (s) { err.push(String(s)); }
    });
  }
  return ready;
}
self.onmessage = async function (e) {
  var d = e.data, id = d.id;
  try {
    var q = await load();
    err = [];
    q.FS.writeFile('/in.pdf', new Uint8Array(d.bytes));
    var args = ['--decrypt'];
    if (d.password) args.push('--password=' + d.password);
    args.push('/in.pdf', '/out.pdf');
    var rc, ce = console.error, cl = console.log;
    console.error = console.warn = function (m) { err.push(String(m)); };
    console.log = function () {};
    try { rc = q.callMain(args); } catch (ex) { rc = (ex && typeof ex.status === 'number') ? ex.status : 2; }
    console.error = ce; console.log = cl;
    var out = null;
    try { out = q.FS.readFile('/out.pdf'); q.FS.unlink('/out.pdf'); } catch (ex) {}
    try { q.FS.unlink('/in.pdf'); } catch (ex) {}
    var msg = err.join(' ');
    if (out && (rc === 0 || rc === 3)) {
      var buf = out.slice().buffer;
      self.postMessage({ id: id, ok: true, bytes: buf, warn: rc === 3 ? msg : '' }, [buf]);
    } else {
      self.postMessage({ id: id, ok: false, badPassword: /invalid password/i.test(msg), msg: msg });
    }
  } catch (ex) {
    self.postMessage({ id: id, ok: false, msg: String(ex && ex.message || ex) });
  }
};
