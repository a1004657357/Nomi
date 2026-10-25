from setuptools import find_namespace_packages, setup


setup(
    name="cli-anything-blender",
    version="0.1.0",
    description="Constrained Blender director harness for Nomi",
    python_requires=">=3.10",
    packages=find_namespace_packages(include=["cli_anything.*"]),
    install_requires=["click>=8.1,<9"],
    extras_require={"test": ["pytest>=8,<10"]},
    entry_points={
        "console_scripts": [
            "cli-anything-blender=cli_anything.blender.blender_cli:main",
        ],
    },
)
