mod run;
#[cfg(all(feature = "embed", feature = "download"))]
mod serve;

use std::path::Path;

const VERSION: &str = env!("CARGO_PKG_VERSION");
const USAGE: &str = "usage: codebase-wiki-mcp <index|search|status|models|serve> [--repo P] [--json]
  index  [--repo P] [--json]
  search [--repo P] [-k N] [--glob G] [--json] \"query\"
  status [--repo P] [--json]
  models list [--json] | models pull <id> [--json] | models search <q> [--json] | models add <hf_repo> [--json]
  serve  [--repo P]";

/// Parsed command line: flags anywhere, everything else positional (in order).
struct Args {
    positional: Vec<String>,
    json: bool,
    repo: Option<String>,
    k: Option<usize>,
    glob: Option<String>,
}

fn parse(raw: &[String]) -> Result<Args, String> {
    let mut a = Args { positional: Vec::new(), json: false, repo: None, k: None, glob: None };
    let mut it = raw.iter();
    while let Some(arg) = it.next() {
        let mut value = |name: &str| it.next().cloned().ok_or(format!("{name} vuole un valore"));
        match arg.as_str() {
            "--json" => a.json = true,
                "--repo" => a.repo = Some(value("--repo")?),
            "--glob" => a.glob = Some(value("--glob")?),
            "-k" => a.k = Some(value("-k")?.parse().map_err(|_| "-k vuole un numero".to_string())?),
            s if s.starts_with('-') && s.len() > 1 => return Err(format!("opzione sconosciuta: {s}")),
            _ => a.positional.push(arg.clone()),
        }
    }
    Ok(a)
}

fn fail(json: bool, msg: &str) -> ! {
    if json {
        println!("{}", serde_json::json!({"event":"error","message":msg}));
    } else {
        eprintln!("{msg}");
    }
    std::process::exit(1)
}

fn main() {
    let raw: Vec<String> = std::env::args().skip(1).collect();
    if matches!(raw.first().map(String::as_str), Some("--version" | "-V")) {
        println!("codebase-wiki-mcp {VERSION}");
        return;
    }
    let json_hint = raw.iter().any(|a| a == "--json");
    let args = parse(&raw).unwrap_or_else(|e| fail(json_hint, &format!("{e}\n{USAGE}")));
    let Some(cmd) = args.positional.first().cloned() else { fail(false, USAGE) };
    let repo = args.repo.as_deref().map(Path::new);
    match cmd.as_str() {
        #[cfg(all(feature = "embed", feature = "download"))]
        "index" => std::process::exit(run::run_index(repo, args.json)),
        #[cfg(all(feature = "embed", feature = "download"))]
        "search" => {
            let query = args.positional[1..].join(" ");
            if query.trim().is_empty() {
                fail(args.json, "search vuole una domanda");
            }
            std::process::exit(run::run_search(repo, args.k.unwrap_or(8), args.glob.as_deref(), &query, args.json));
        }
        #[cfg(all(feature = "embed", feature = "download"))]
        "status" => std::process::exit(run::run_status(repo, args.json)),
        #[cfg(all(feature = "embed", feature = "download"))]
        "serve" => {
            if let Err(e) = serve::run(repo) {
                eprintln!("{e}");
                std::process::exit(1);
            }
        }
        #[cfg(feature = "download")]
        "models" => models_cmd(&args),
        _ => fail(args.json, &format!("comando sconosciuto o non compilato in questo binario: {cmd}\n{USAGE}")),
    }
}

#[cfg(feature = "download")]
fn models_cmd(args: &Args) {
    let json = args.json;
    match args.positional.get(1).map(String::as_str) {
        Some("list") => {
            let installed = rag_core::models::installed_ids();
            if json {
                let mut catalog: Vec<_> = rag_core::catalog()
                    .iter()
                    .map(|m| {
                        serde_json::json!({"id": m.id, "dims": m.dims, "size_mb": m.size_mb, "languages": m.languages,
                            "note": m.note, "tested": m.tested, "installed": installed.iter().any(|i| i == m.id)})
                    })
                    .collect();
                for custom in rag_core::models::custom_catalog_rows() {
                    catalog.push(serde_json::json!({
                        "id": custom.id,
                        "dims": custom.dims,
                        "size_mb": custom.size_mb,
                        "languages": custom.languages,
                        "note": custom.note,
                        "tested": custom.tested,
                        "installed": installed.iter().any(|i| i == &custom.id),
                    }));
                }
                let r = rag_core::catalog::reranker_spec();
                let reranker = serde_json::json!({"id": r.id, "size_mb": r.size_mb, "languages": r.languages,
                    "installed": installed.iter().any(|i| i == r.id)});
                println!("{}", serde_json::json!({"installed": installed, "catalog": catalog, "reranker": reranker}));
            } else {
                println!("Installati: {}", installed.join(", "));
            }
        }
        Some("pull") => {
            let Some(id) = args.positional.get(2) else { fail(json, "models pull vuole un id") };
            let reranker = rag_core::catalog::reranker_spec();
            let Some(spec) = rag_core::model_by_id(id).or((id == reranker.id).then_some(reranker)) else { fail(json, &format!("modello sconosciuto: {id}")) };
            let res = rag_core::models::pull(spec, |ev| {
                if json {
                    println!("{}", serde_json::json!({"event":"download","file":ev.file,"done":ev.done,"total":ev.total}));
                }
            });
            match res {
                Ok(()) if json => println!("{}", serde_json::json!({"event":"done","model":spec.id})),
                Ok(()) => {}
                Err(e) => fail(json, &e.to_string()),
            }
        }
        Some("search") => {
            let q = args.positional[2..].join(" ");
            if q.trim().is_empty() {
                fail(json, "models search vuole un testo");
            }
            match rag_core::models::hf_search(&q) {
                Ok(hits) if json => println!("{}", serde_json::to_string(&hits).unwrap_or_default()),
                Ok(hits) => hits.iter().for_each(|h| println!("{} ({})", h.id, h.downloads)),
                Err(e) => fail(json, &e.to_string()),
            }
        }
        Some("add") => {
            let Some(repo_name) = args.positional.get(2) else {
                fail(json, "models add vuole un repo Hugging Face");
            };
            match rag_core::models::add_custom(repo_name) {
                Ok(id) if json => println!("{}", serde_json::json!({"event":"done","model":id})),
                Ok(id) => println!("Aggiunto modello {id}"),
                Err(e) => fail(json, &e.to_string()),
            }
        }
        _ => fail(json, USAGE),
    }
}
