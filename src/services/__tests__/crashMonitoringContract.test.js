const fs = require('fs');
const path = require('path');

function read(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
}

describe('crash monitoring integration contract', () => {
  it('mounts the recovery boundary and global handler at the root layout', () => {
    const layout = read('../../app/_layout.jsx');
    expect(layout).toContain("import AppErrorBoundary from '../components/AppErrorBoundary'");
    expect(layout).toContain('installGlobalErrorHandler();');
    expect(layout).toContain('setCurrentCrashRoute(pathname)');
    expect(layout).toContain('<AppErrorBoundary route={pathname}>');
  });

  it('preserves the original React Native fatal handler', () => {
    const reporter = read('../clientErrorReporter.js');
    expect(reporter).toContain('previousGlobalHandler(error, isFatal)');
    expect(reporter).toContain("source: 'javascript_global'");
    expect(reporter).toContain("'[CLIENT_ERROR] report.failed'");
  });

  it('never logs raw crash message or stack in the client summary', () => {
    const reporter = read('../clientErrorReporter.js');
    expect(reporter).toContain('Never log message, stack, componentStack or raw context locally');
    expect(reporter).not.toContain('message: payload.message');
    expect(reporter).not.toContain('stack: payload.stack');
  });
});
