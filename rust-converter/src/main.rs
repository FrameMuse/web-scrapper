use std::io::Read;
use scraper::{Html, ElementRef, Node as ScraperNode};
use turndown_cdp::{TurndownService, Node, HeadingStyle, CodeBlockStyle};

fn convert_node(node: &ego_tree::NodeRef<'_, ScraperNode>) -> Option<Node> {
    match node.value() {
        ScraperNode::Text(text) => {
            let s = text.text.as_ref();
            if s.trim().is_empty() {
                return None;
            }
            Some(Node::text(s))
        }
        ScraperNode::Element(elem) => {
            let tag: &str = elem.name.local.as_ref();

            // <br> → newline text node so code blocks preserve line breaks
            if tag == "br" {
                return Some(Node::text("\n"));
            }

            let attrs: Vec<(&str, &str)> = elem.attrs().collect();
            let mut result = if attrs.is_empty() {
                Node::element(tag)
            } else {
                Node::element_with_attrs(tag, attrs)
            };

            for child in node.children() {
                if let Some(child_node) = convert_node(&child) {
                    result.add_child(child_node);
                }
            }

            Some(result)
        }
        _ => None,
    }
}

fn convert_element(elem: ElementRef) -> Node {
    let tag: &str = elem.value().name.local.as_ref();
    let attrs: Vec<(&str, &str)> = elem.value().attrs().collect();
    let mut node = if attrs.is_empty() {
        Node::element(tag)
    } else {
        Node::element_with_attrs(tag, attrs)
    };

    for child in elem.children() {
        if let Some(child_node) = convert_node(&child) {
            node.add_child(child_node);
        }
    }

    node
}

fn main() {
    let mut html = String::new();
    std::io::stdin().read_to_string(&mut html).expect("Failed to read stdin");

    let doc = Html::parse_document(&html);
    let root = doc.root_element();

    let service = TurndownService::with_options(turndown_cdp::TurndownOptions {
        heading_style: HeadingStyle::Atx,
        code_block_style: CodeBlockStyle::Fenced,
        bullet_list_marker: '-',
        ..Default::default()
    });

    let node = convert_element(root);
    match service.turndown(&node) {
        Ok(md) => println!("{}", md),
        Err(e) => {
            eprintln!("Error: {}", e);
            std::process::exit(1);
        }
    }
}
