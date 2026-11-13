//! Language of messages shown to the person (Italian or English), set by the app.

use std::sync::atomic::{AtomicBool, Ordering};

static ENGLISH: AtomicBool = AtomicBool::new(false);

pub fn set_english(on: bool) {
    ENGLISH.store(on, Ordering::Relaxed);
}

/// `it` or `en` depending on the language the app chose.
pub fn tr(it: &str, en: &str) -> String {
    if ENGLISH.load(Ordering::Relaxed) { en } else { it }.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tr_follows_the_chosen_language() {
        set_english(true);
        assert_eq!(tr("ciao", "hello"), "hello");
        set_english(false);
        assert_eq!(tr("ciao", "hello"), "ciao");
    }
}
