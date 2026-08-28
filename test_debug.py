from goeddel.use.app import get_breadcrumbs, resolve_root_and_subpath
from goeddel.use.config import AppConfig, RootConfig
from goeddel.use.models.root_folder import RootFolder
from goeddel.use.mounts import MountsManager

MountsManager.get_instance()
rc = RootConfig(root_path="/host", sub_path="")
RootFolder.set_root_configs({"host": rc})
config = AppConfig(roots={"host": rc}, host="0.0.0.0", port=8080, theme="dark")

base_name, sub_path, root_folder = resolve_root_and_subpath("host/-/root", config)
print(f"Shadow root: base_name={base_name}, sub_path={sub_path}, physical_path={root_folder._root_path}, logical_sub_path={root_folder.logical_sub_path}")

file_node = root_folder.get_file(path=sub_path, snapshot="Original")
bc = get_breadcrumbs(root_folder, base_name, file_node, [], [])
print(f"Breadcrumbs paths: {bc['paths']}")
