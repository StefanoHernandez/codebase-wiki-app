mod run;

const VERSION: &str = env!("CARGO_PKG_VERSION");

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|a| a == "--version" || a == "-V") {
        println!("codebase-wiki-mcp {VERSION}");
        return;
    }
    let Some(cmd) = args.get(1) else {
        eprintln!("usage: codebase-wiki-mcp <index|search|status|models|serve>");
        std::process::exit(1);
    };
    match cmd.as_str() {
        #[cfg(all(feature = "embed", feature = "download"))]
        "index" => {
            let json = args.iter().any(|a| a == "--json");
            let repo = repo_flag(&args);
            std::process::exit(run::run_index(repo.as_deref().map(std::path::Path::new), json));
        }
        #[cfg(all(feature = "embed", feature = "download"))]
        "search" => {
            let wiki = args.iter().any(|a| a == "--wiki");
            let json = args.iter().any(|a| a == "--json");
            let k = flag_usize(&args, "-k").unwrap_or(8);
            let glob = flag_str(&args, "--glob");
            let repo = repo_flag(&args);
            let query = args.last().cloned().unwrap_or_default();
            if json {
                let _ = json;
            }
            std::process::exit(run::run_search(
                repo.as_deref().map(std::path::Path::new),
                wiki,
                k,
                glob.as_deref(),
                &query,
            ));
        }
        #[cfg(all(feature = "embed", feature = "download"))]
        "status" => {
            let json = args.iter().any(|a| a == "--json");
            let repo = repo_flag(&args);
            std::process::exit(run::run_status(repo.as_deref().map(std::path::Path::new), json));
        }
        #[cfg(feature = "download")]
        "models" => models_cmd(&args),
        "serve" => {
            #[cfg(all(feature = "embed", feature = "download"))]
            {
                if let Err(e) = serve::run(args.clone()) {
                    eprintln!("{e}");
                    std::process::exit(1);
                }
                return;
            }
            #[cfg(not(all(feature = "embed", feature = "download")))]
            {
                eprintln!("serve richiede feature embed");
                std::process::exit(1);
            }
        }
        _ => {
            eprintln!("comando sconosciuto: {cmd}");
            std::process::exit(1);
        }
    }
}

#[cfg(all(feature = "embed", feature = "download"))]
mod serve;

fn repo_flag(args: &[String]) -> Option<String> {
    args.iter()
        .position(|a| a == "--repo")
        .and_then(|i| args.get(i + 1).cloned())
}

fn flag_usize(args: &[String], name: &str) -> Option<usize> {
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1))
        .and_then(|s| s.parse().ok())
}

fn flag_str(args: &[String], name: &str) -> Option<String> {
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1).cloned())
}

#[cfg(feature = "download")]
fn models_cmd(args: &[String]) {
    let json = args.iter().any(|a| a == "--json");
    match args.get(2).map(String::as_str) {
        Some("list") => {
            let installed = rag_core::models::installed_ids();
            if json {
                println!(
                    "{}",
                    serde_json::json!({"installed": installed, "catalog": rag_core::catalog().iter().map(|m| m.id).collect::<Vec<_>>()})
                );
            } else {
                println!("Installati: {}", installed.join(", "));
            }
        }
        Some("pull") if args.len() >= 4 => {
            let id = &args[3];
            let Some(spec) = rag_core::model_by_id(id) else {
                eprintln!("modello sconosciuto");
                std::process::exit(1);
            };
            let res = rag_core::models::pull(spec, |ev| {
                if json {
                    println!(
                        "{}",
                        serde_json::json!({"event":"download","file":ev.file,"done":ev.done,"total":ev.total})
                    );
                }
            });
            if res.is_err() {
                if json {
                    println!("{{\"event\":\"error\",\"message\":\"{}\"}}", res.unwrap_err());
                }
                std::process::exit(1);
            }
        }
        #[cfg(feature = "embed")]
        Some("search") => {
            eprintln!("models search: implementato in B12");
            std::process::exit(1);
        }
        _ => {
            eprintln!("usage: models list|pull <id>");
            std::process::exit(1);
        }
    }
}
