use std::io::Read;
use scraper::{Html, ElementRef, Node as ScraperNode};
use turndown_cdp::{TurndownService, Node, HeadingStyle, CodeBlockStyle};

struct CodeByRule {
    tag: Option<String>,
    class: Option<String>,
}

fn parse_code_by_rule(s: &str) -> CodeByRule {
    let parts: Vec<&str> = s.split('.').collect();
    if parts.len() == 1 {
        if parts[0].starts_with('.') {
            CodeByRule { tag: None, class: Some(parts[0][1..].to_string()) }
        } else {
            CodeByRule { tag: Some(parts[0].to_string()), class: None }
        }
    } else if parts[0].is_empty() {
        CodeByRule { tag: None, class: Some(parts[1].to_string()) }
    } else {
        CodeByRule { tag: Some(parts[0].to_string()), class: Some(parts[1].to_string()) }
    }
}

fn matches_code_by(elem: ElementRef, rules: &[CodeByRule]) -> bool {
    let tag: &str = elem.value().name.local.as_ref();
    let class = elem.attr("class");
    rules.iter().any(|r| {
        if let Some(ref rt) = r.tag {
            if !tag.eq_ignore_ascii_case(rt) { return false; }
        }
        if let Some(ref rc) = r.class {
            if class.map_or(true, |c| !c.split_whitespace().any(|w| w == rc)) { return false; }
        }
        true
    })
}

/// Walk children of a code-by matched element, splitting around <a> tags
fn convert_code_by_element(node: &ego_tree::NodeRef<'_, ScraperNode>, elem: ElementRef, rules: &[CodeByRule]) -> Node {
    let inner = elem.value();
    let tag: &str = inner.name.local.as_ref();
    let attrs: Vec<(&str, &str)> = inner.attrs.iter().map(|(name, val)| {
        let k: &str = name.local.as_ref();
        let v: &str = val.as_ref();
        (k, v)
    }).collect();
    let mut result = if attrs.is_empty() { Node::element(tag) } else { Node::element_with_attrs(tag, attrs) };

    let mut buf = String::new();

    let flush = |buf: &mut String, parent: &mut Node| {
        if !buf.is_empty() {
            let mut code = Node::element("code");
            code.add_child(Node::text(&buf));
            parent.add_child(code);
            buf.clear();
        }
    };

    for child in node.children() {
        match child.value() {
            ScraperNode::Text(text) => {
                buf.push_str(text.text.as_ref());
            }
            ScraperNode::Element(_) => {
                if let Some(child_ref) = ElementRef::wrap(child) {
                    let child_tag: &str = child_ref.value().name.local.as_ref();
                    if child_tag == "a" {
                        flush(&mut buf, &mut result);
                        if let Some(link) = convert_node(&child, rules) {
                            result.add_child(link);
                        }
                    } else if child_tag == "br" {
                        buf.push('\n');
                    } else {
                        buf.push_str(&collect_text(&child));
                    }
                }
            }
            _ => {}
        }
    }

    flush(&mut buf, &mut result);
    result
}

fn collect_text(node: &ego_tree::NodeRef<'_, ScraperNode>) -> String {
    let mut out = String::new();
    for child in node.children() {
        match child.value() {
            ScraperNode::Text(text) => { out.push_str(text.text.as_ref()); }
            ScraperNode::Element(elem) => {
                if elem.name.local.as_ref() == "br" {
                    out.push('\n');
                } else {
                    out.push_str(&collect_text(&child));
                }
            }
            _ => {}
        }
    }
    out
}

/// Map Docusaurus admonition class to GFM alert type
fn admonition_type(class: &str) -> Option<&'static str> {
    if class.contains("theme-admonition-note") || class.contains("theme-admonition-info") {
        Some("NOTE")
    } else if class.contains("theme-admonition-tip") {
        Some("TIP")
    } else if class.contains("theme-admonition-important") {
        Some("IMPORTANT")
    } else if class.contains("theme-admonition-warning") {
        Some("WARNING")
    } else if class.contains("theme-admonition-danger") || class.contains("theme-admonition-caution") {
        Some("CAUTION")
    } else {
        None
    }
}

/// Convert Docusaurus admonition div to GFM alert blockquote
fn convert_admonition(node: &ego_tree::NodeRef<'_, ScraperNode>, atype: &str, rules: &[CodeByRule]) -> Option<Node> {
    // Find admonitionContent child — its children become blockquote paragraphs
    let mut content_children: Vec<Node> = Vec::new();

    for child in node.children() {
        match child.value() {
            ScraperNode::Element(e) => {
                let tag: &str = e.name.local.as_ref();
                if tag == "div" {
                    if let Some(elem_ref) = ElementRef::wrap(child) {
                        let cls = elem_ref.attr("class").unwrap_or("");
                        if cls.contains("admonitionContent") {
                            // Collect content children as blockquote paragraphs
                            for content_child in child.children() {
                                if let Some(cn) = convert_node(&content_child, rules) {
                                    content_children.push(cn);
                                }
                            }
                        }
                    }
                }
            }
            _ => {}
        }
    }

    if content_children.is_empty() { return None; }

    // Build blockquote: first paragraph has "[!TYPE]", then content follows
    let mut bq = Node::element("blockquote");

    let mut first_p = Node::element("p");
    first_p.add_child(Node::text(&format!("[!{}]", atype)));
    bq.add_child(first_p);

    for c in content_children {
        bq.add_child(c);
    }

    Some(bq)
}

fn convert_node(node: &ego_tree::NodeRef<'_, ScraperNode>, rules: &[CodeByRule]) -> Option<Node> {
    match node.value() {
        ScraperNode::Text(text) => {
            let s = text.text.as_ref();
            if s.is_empty() { return None; }
            Some(Node::text(s))
        }
        ScraperNode::Element(elem) => {
            let tag: &str = elem.name.local.as_ref();
            if tag == "br" { return Some(Node::text("\n")); }

            // Check --code-by match
            if let Some(elem_ref) = ElementRef::wrap(*node) {
                if matches_code_by(elem_ref, rules) {
                    return Some(convert_code_by_element(node, elem_ref, rules));
                }
            }

            // Check for Docusaurus admonitions
            if tag == "div" {
                if let Some(cls) = elem.attr("class") {
                    if let Some(atype) = admonition_type(cls) {
                        if let Some(result) = convert_admonition(node, atype, rules) {
                            return Some(result);
                        }
                    }
                }
            }

            let attrs: Vec<(&str, &str)> = elem.attrs().collect();

            // For <pre>, propagate language class to child <code> if missing
            if tag == "pre" {
                let pre_lang = elem.attr("class")
                    .and_then(|c| c.split_whitespace().find(|s| s.starts_with("language-")));
                let mut result = Node::element_with_attrs(tag, attrs);
                for child in node.children() {
                    if let Some(mut child_node) = convert_node(&child, rules) {
                        if let Some(lang) = pre_lang {
                            if child_node.tag_name() == "code"
                                && child_node.attr("class").map_or(true, |c| !c.contains(lang))
                            {
                                let old_class = child_node.attr("class").unwrap_or("");
                                let new_class = if old_class.is_empty() { lang.to_string() } else { format!("{} {}", old_class, lang) };
                                child_node.set_attr("class", &new_class);
                            }
                        }
                        result.add_child(child_node);
                    }
                }
                return Some(result);
            }

            let mut result = if attrs.is_empty() {
                Node::element(tag)
            } else {
                Node::element_with_attrs(tag, attrs)
            };

            for child in node.children() {
                if let Some(child_node) = convert_node(&child, rules) {
                    result.add_child(child_node);
                }
            }

            Some(result)
        }
        _ => None,
    }
}

fn convert_element(elem: ElementRef, rules: &[CodeByRule]) -> Node {
    let tag: &str = elem.value().name.local.as_ref();
    let attrs: Vec<(&str, &str)> = elem.value().attrs().collect();
    let mut node = if attrs.is_empty() {
        Node::element(tag)
    } else {
        Node::element_with_attrs(tag, attrs)
    };

    for child in elem.children() {
        if let Some(child_node) = convert_node(&child, rules) {
            node.add_child(child_node);
        }
    }

    node
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let rules: Vec<CodeByRule> = args[1..].iter().map(|s| parse_code_by_rule(s)).collect();

    let mut html = String::new();
    std::io::stdin().read_to_string(&mut html).expect("Failed to read stdin");

    let doc = Html::parse_document(&html);
    let root = doc.root_element();

    let service = TurndownService::with_options(turndown_cdp::TurndownOptions {
        heading_style: HeadingStyle::Atx,
        code_block_style: CodeBlockStyle::Fenced,
        bullet_list_marker: '-',
        hr: "---".to_string(),
        ..Default::default()
    });

    let node = convert_element(root, &rules);
    match service.turndown(&node) {
        Ok(md) => println!("{}", md),
        Err(e) => {
            eprintln!("Error: {}", e);
            std::process::exit(1);
        }
    }
}
