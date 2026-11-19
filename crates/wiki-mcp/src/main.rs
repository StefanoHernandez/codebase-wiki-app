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
    let mut end_of_opts = false;
    while let Some(arg) = it.next() {
        if end_of_opts {
            a.positional.push(arg.clone());
            continue;
        }
        if arg == "--" {
            end_of_opts = true;
            continue;
        }
        let mut value = |name: &str| it.next().cloned().ok_or(format!("{name} requires a value"));
        match arg.as_str() {
            "--json" => a.json = true,
            "--repo" => a.repo = Some(value("--repo")?),
            "--glob" => a.glob = Some(value("--glob")?),
            "-k" => a.k = Some(value("-k")?.parse().map_err(|_| "-k requires a number".to_string())?),
            s if s.starts_with('-') && s.len() > 1 => return Err(format!("unknown option: {s}")),
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
    #[cfg_attr(not(all(feature = "embed", feature = "download")), allow(unused_variables))]
    let repo = args.repo.as_deref().map(Path::new);
    match cmd.as_str() {
        #[cfg(all(feature = "embed", feature = "download"))]
        "index" => std::process::exit(run::run_index(repo, args.json)),
        #[cfg(all(feature = "embed", feature = "download"))]
        "search" => {
            let query = args.positional[1..].join(" ");
            if query.trim().is_empty() {
                fail(args.json, "search requires a query");
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
        _ => fail(args.json, &format!("unknown or uncompiled command: {cmd}\n{USAGE}")),
    }
}

#[cfg(feature = "download")]
fn models_cmd(args: &Args) {
    let json = args.json;
    match args.positional.get(1).map(String::as_str) {
        Some("list") => {
            if json {
                println!("{}", rag_core::models_list_json());
            } else {
                let installed = rag_core::models::installed_ids();
                println!("Installed: {}", installed.join(", "));
            }
        }
        Some("pull") => {
            let Some(id) = args.positional.get(2) else { fail(json, "models pull requires an id") };
            let reranker = rag_core::catalog::reranker_spec();
            let Some(spec) = rag_core::model_by_id(id).or((id == reranker.id).then_some(reranker)) else { fail(json, &format!("unknown model: {id}")) };
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
                fail(json, "models search requires a query");
            }
            match rag_core::models::hf_search(&q) {
                Ok(hits) if json => println!("{}", serde_json::to_string(&hits).unwrap_or_default()),
                Ok(hits) => hits.iter().for_each(|h| println!("{} ({})", h.id, h.downloads)),
                Err(e) => fail(json, &e.to_string()),
            }
        }
        Some("add") => {
            let Some(repo_name) = args.positional.get(2) else {
                fail(json, "models add requires a Hugging Face repo");
            };
            match rag_core::models::add_custom(repo_name) {
                Ok(id) if json => println!("{}", serde_json::json!({"event":"done","model":id})),
                Ok(id) => println!("Added model {id}"),
                Err(e) => fail(json, &e.to_string()),
            }
        }
        _ => fail(json, USAGE),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_supports_end_of_options_for_flag_like_queries() {
        let raw: Vec<String> = [
            "search", "--repo", "/r", "-k", "8", "--json", "--", "--no-renames", "-Wall",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        let a = parse(&raw).unwrap();
        assert_eq!(a.repo.as_deref(), Some("/r"));
        assert_eq!(a.k, Some(8));
        assert!(a.json);
        assert_eq!(a.positional, vec!["search", "--no-renames", "-Wall"]);

        let single: Vec<String> = ["search", "--", "-k"].iter().map(|s| s.to_string()).collect();
        let b = parse(&single).unwrap();
        assert_eq!(b.k, None);
        assert_eq!(b.positional, vec!["search", "-k"]);

        let bad: Vec<String> = ["search", "--no-renames"].iter().map(|s| s.to_string()).collect();
        assert!(parse(&bad).is_err());
    }
}
