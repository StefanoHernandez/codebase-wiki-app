#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Pooling {
    Mean,
    Cls,
}

#[derive(Debug, Clone)]
pub struct ModelSpec {
    pub id: &'static str,
    pub hf_repo: &'static str,
    pub files: &'static [(&'static str, &'static str)],
    pub dims: u32,
    pub pooling: Pooling,
    pub normalize: bool,
    pub query_prefix: &'static str,
    pub passage_prefix: &'static str,
    pub max_tokens: u32,
    pub size_mb: u32,
    pub languages: &'static str,
    pub note: &'static str,
    pub tested: bool,
}

pub fn catalog() -> &'static [ModelSpec] {
    static MODELS: [ModelSpec; 6] = [
        ModelSpec {
            id: "multilingual-e5-small",
            hf_repo: "Xenova/multilingual-e5-small",
            files: &[(
                "onnx/model_quantized.onnx",
                "model.onnx",
            ), (
                "tokenizer.json",
                "tokenizer.json",
            ), (
                "config.json",
                "config.json",
            ), (
                "special_tokens_map.json",
                "special_tokens_map.json",
            ), (
                "tokenizer_config.json",
                "tokenizer_config.json",
            )],
            dims: 384,
            pooling: Pooling::Mean,
            normalize: true,
            query_prefix: "query: ",
            passage_prefix: "passage: ",
            max_tokens: 512,
            size_mb: 118,
            languages: "multilingue (IT, EN, …)",
            note: "Default; adatto a wiki in italiano",
            tested: true,
        },
        ModelSpec {
            id: "bge-small-en-v1.5",
            hf_repo: "Xenova/bge-small-en-v1.5",
            files: &[("onnx/model_quantized.onnx", "model.onnx"), ("tokenizer.json", "tokenizer.json"), ("config.json", "config.json"), ("special_tokens_map.json", "special_tokens_map.json"), ("tokenizer_config.json", "tokenizer_config.json")],
            dims: 384,
            pooling: Pooling::Cls,
            normalize: true,
            query_prefix: "Represent this sentence for searching relevant passages: ",
            passage_prefix: "",
            max_tokens: 512,
            size_mb: 34,
            languages: "EN",
            note: "Provato: buono sul codice in inglese, debole con domande in italiano",
            tested: true,
        },
        ModelSpec {
            id: "all-MiniLM-L6-v2",
            hf_repo: "Xenova/all-MiniLM-L6-v2",
            files: &[("onnx/model_quantized.onnx", "model.onnx"), ("tokenizer.json", "tokenizer.json"), ("config.json", "config.json"), ("special_tokens_map.json", "special_tokens_map.json"), ("tokenizer_config.json", "tokenizer_config.json")],
            dims: 384,
            pooling: Pooling::Mean,
            normalize: true,
            query_prefix: "",
            passage_prefix: "",
            max_tokens: 256,
            size_mb: 23,
            languages: "EN",
            note: "Il più piccolo",
            tested: false,
        },
        ModelSpec {
            id: "multilingual-e5-base",
            hf_repo: "Xenova/multilingual-e5-base",
            files: &[("onnx/model_quantized.onnx", "model.onnx"), ("tokenizer.json", "tokenizer.json"), ("config.json", "config.json"), ("special_tokens_map.json", "special_tokens_map.json"), ("tokenizer_config.json", "tokenizer_config.json")],
            dims: 768,
            pooling: Pooling::Mean,
            normalize: true,
            query_prefix: "query: ",
            passage_prefix: "passage: ",
            max_tokens: 512,
            size_mb: 279,
            languages: "multilingue",
            note: "Provato: non supera e5-small e indicizza 2,5 volte più lento",
            tested: true,
        },
        ModelSpec {
            id: "nomic-embed-text-v1.5",
            hf_repo: "nomic-ai/nomic-embed-text-v1.5",
            files: &[("onnx/model_quantized.onnx", "model.onnx"), ("tokenizer.json", "tokenizer.json"), ("config.json", "config.json"), ("special_tokens_map.json", "special_tokens_map.json"), ("tokenizer_config.json", "tokenizer_config.json")],
            dims: 768,
            pooling: Pooling::Mean,
            normalize: true,
            query_prefix: "search_query: ",
            passage_prefix: "search_document: ",
            max_tokens: 8192,
            size_mb: 137,
            languages: "EN",
            note: "Contesto lungo",
            tested: false,
        },
        ModelSpec {
            id: "jina-embeddings-v2-base-code",
            hf_repo: "jinaai/jina-embeddings-v2-base-code",
            files: &[("onnx/model_quantized.onnx", "model.onnx"), ("tokenizer.json", "tokenizer.json"), ("config.json", "config.json"), ("special_tokens_map.json", "special_tokens_map.json"), ("tokenizer_config.json", "tokenizer_config.json")],
            dims: 768,
            pooling: Pooling::Mean,
            normalize: true,
            query_prefix: "",
            passage_prefix: "",
            max_tokens: 8192,
            size_mb: 162,
            languages: "code",
            note: "Provato: simile a e5-small, indicizza 3 volte più lento",
            tested: true,
        },
    ];
    &MODELS
}

/// Optional cross-encoder that re-orders the fused BM25+vector candidates.
/// Not an embedding model (kept out of `catalog()`); installed with `models pull <id>`.
pub fn reranker_spec() -> &'static ModelSpec {
    static RERANKER: ModelSpec = ModelSpec {
        id: "jina-reranker-v2-base-multilingual",
        hf_repo: "jinaai/jina-reranker-v2-base-multilingual",
        files: &[
            ("onnx/model_quantized.onnx", "model.onnx"),
            ("tokenizer.json", "tokenizer.json"),
            ("config.json", "config.json"),
            ("special_tokens_map.json", "special_tokens_map.json"),
            ("tokenizer_config.json", "tokenizer_config.json"),
        ],
        dims: 0,
        pooling: Pooling::Cls,
        normalize: false,
        query_prefix: "",
        passage_prefix: "",
        max_tokens: 1024,
        size_mb: 266,
        languages: "multilingue",
        note: "Reranker opzionale",
        tested: false,
    };
    &RERANKER
}

pub fn model_by_id(id: &str) -> Option<&'static ModelSpec> {
    catalog()
        .iter()
        .find(|m| m.id == id)
        .or_else(|| {
            #[cfg(feature = "download")]
            {
                crate::models::custom_model_spec(id)
            }
            #[cfg(not(feature = "download"))]
            {
                None
            }
        })
}

pub fn default_model_id() -> &'static str {
    "multilingual-e5-small"
}
