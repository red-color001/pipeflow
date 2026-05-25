# PyInstaller spec for the pipeflow-agent binary.
#
# Build locally:
#   cd <repo root>
#   pip install -e packages/sdk-py pyinstaller
#   pyinstaller agents/pyinstaller.spec --noconfirm
#
# Output: dist/pipeflow-agent[.exe]
#
# CI builds the same spec on win/linux/mac runners — see
# .github/workflows/release.yml.

from PyInstaller.utils.hooks import collect_all

datas, binaries, hiddenimports = [], [], ['pipeflow_agent']
for pkg in ('pipeflow_agent', 'requests'):
    d, b, h = collect_all(pkg)
    datas += d
    binaries += b
    hiddenimports += h

a = Analysis(
    ['runner.py'],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    # NOTE: do NOT exclude 'distutils' — Python 3.12+ ships a setuptools shim
    # (_distutils_hack) that auto-imports it; excluding triggers
    # "Target module 'distutils' already imported as ExcludedModule" at build.
    excludes=['tkinter', 'unittest', 'test'],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='pipeflow-agent',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
