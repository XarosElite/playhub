{
  description = "Basic Python environment flake";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      system = "x86_64-linux"; # change if needed
      pkgs = import nixpkgs { inherit system; };
    in {
      devShells.${system}.default = pkgs.mkShell {
        packages = [
          pkgs.pyright
          (pkgs.python3.withPackages (ps: with ps; [
            pip
            virtualenv
            requests
            fastapi
            fastapi-cli
          ]))
        ];

        shellHook = ''
          echo "🐍 Python environment ready!"
        '';
      };
    };
}

