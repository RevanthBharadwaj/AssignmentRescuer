//! Scholarly lookups (Crossref, OpenAlex, Semantic Scholar). Only a short
//! search phrase or a DOI is sent; no course material ever leaves the
//! computer. Only these three hosts can be reached.

use std::io::Read;
use std::time::Duration;

const HOSTS: [&str; 3] = ["api.crossref.org", "api.openalex.org", "api.semanticscholar.org"];
const MAX_BYTES: u64 = 2 * 1024 * 1024;

pub fn validate(url: &str) -> Result<(), String> {
    let lower = url.trim().to_ascii_lowercase();
    let Some(rest) = lower.strip_prefix("https://") else {
        return Err("Scholarly lookups must use https.".into());
    };
    let host = rest.split(['/', '?', '#']).next().unwrap_or("");
    if host.contains('@') || host.contains(':') || !HOSTS.contains(&host) {
        return Err("That address is not an allowed scholarly source.".into());
    }
    Ok(())
}

// Runs off the window thread so the app stays responsive while it waits on the network.
#[tauri::command(async)]
pub fn scholar_get(url: String) -> Result<String, String> {
    validate(&url)?;
    let agent = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(20))
        .redirects(0)
        .user_agent("AssignmentRescueAI/0.1 (student desktop app)")
        .build();
    let resp = agent.get(url.trim()).set("Accept", "application/json").call().map_err(|e| match e {
        ureq::Error::Status(404, _) => "NOT_FOUND".to_string(),
        ureq::Error::Status(429, _) => "That service is busy. Wait a minute and try again.".to_string(),
        ureq::Error::Status(code, _) => format!("The source answered {code}. Try again later."),
        ureq::Error::Transport(_) => "Could not reach the source. Check your internet connection.".into(),
    })?;
    let mut body = String::new();
    resp.into_reader().take(MAX_BYTES).read_to_string(&mut body).map_err(|_| "The answer could not be read.".to_string())?;
    Ok(body)
}

#[cfg(test)]
mod tests {
    use super::validate;

    #[test]
    fn allows_only_the_three_scholarly_hosts() {
        assert!(validate("https://api.crossref.org/works?query=x").is_ok());
        assert!(validate("https://api.openalex.org/works?search=x").is_ok());
        assert!(validate("https://api.semanticscholar.org/graph/v1/paper/search?query=x").is_ok());
        assert!(validate("http://api.crossref.org/works").is_err());
        assert!(validate("https://api.crossref.org.evil.example/works").is_err());
        assert!(validate("https://user@api.crossref.org/works").is_err());
        assert!(validate("https://example.com/works").is_err());
        assert!(validate("https://api.crossref.org:8443/works").is_err());
    }
}
