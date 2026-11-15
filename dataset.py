import h5py
path = "NISAR_L2_PR_GCOV_035_084_A_021_4005_DHDH_A_20261111T002344_20261111T002409_P05036_N_P_J_001.h5"

def show(name, obj):
    if isinstance(obj, h5py.Dataset) and "/GCOV/grids/" in "/" + name:
        print(name, obj.shape, obj.dtype)

with h5py.File(path, "r") as f:
    f.visititems(show)
    d = f["/science/LSAR/GCOV/grids/frequencyA/HHHH"]
    r, c = d.shape[0] // 2, d.shape[1] // 2
    win = d[r:r+500, c:c+500]
    print("window", win.shape, win.min(), win.max(), "zero fraction", (win == 0).mean())