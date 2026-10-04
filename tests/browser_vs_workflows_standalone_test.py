"""The core workbench workflow against the real offline standalone file:// artifact."""
from browser_vs_workflows_test import run


if __name__ == '__main__':
    run(mode='file', suite=__file__)
