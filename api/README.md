# Form Handler

Create a demo form handler that stands as a central store for contact info, assists in form completion, and potentially provides additional features for business analytics

## Brainstorming
Coming up with requirements and decide the best technologies to create a solution

### Requirements
- Store customers information in a single db that can be updated to avoid having to ask around for the right info
- Auto-fill forms to eliminate menial tasks
- Additional analytics or graphs for tracking most profitable customers/types of jobs (?)
- UI that interfaces with other workflows(?)
- Chat/query feature(?)

### Solutions
- LLM
- AI Assistant
- Web App/DB
- Analytical tools/insights


# Fast API Backend
- Install [Nix](https://nixos.org/download/)
- Enable [Nix Flakes](https://nixos.wiki/wiki/Flakes)
```
nix develop                           # Drop into the Nix Shell
fastapi dev main.py --host 0.0.0.0    # Start the Fast API in dev mode
```
