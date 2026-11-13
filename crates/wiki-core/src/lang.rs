//! Language of messages shown to the person (Italian or English), set by the app.

use std::sync::atomic::{AtomicBool, Ordering};

static ENGLISH: AtomicBool = AtomicBool::new(false);

pub fn set_english(on: bool) {
    ENGLISH.store(on, Ordering::Relaxed);
}

/// `it` or `en` depending on the language the app chose.
pub fn tr(it: &str, en: &str) -> String {
    pick(ENGLISH.load(Ordering::Relaxed), it, en)
}

fn pick(english: bool, it: &str, en: &str) -> String {
    if english { en } else { it }.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    // Tests `pick`, not `tr`: flipping the global would race with tests asserting Italian messages.
    fn pick_follows_the_language() {
        assert_eq!(pick(true, "ciao", "hello"), "hello");
        assert_eq!(pick(false, "ciao", "hello"), "ciao");
    }
}
