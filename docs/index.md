---
layout: splash
title: 'StratoSort Core'
permalink: /
header:
  overlay_color: '#000'
  overlay_filter: '0.6'
  overlay_image: /assets/e2e-screenshots/01_welcome_screen.webp
  caption: 'Privacy-first local AI document organizer.'
  actions:
    - label: 'Download Latest Release'
      url: 'https://github.com/iLevyTate/StratoSortCore/releases'
      btn_class: 'btn--primary'
    - label: 'Read the Docs'
      url: '/INSTALL_GUIDE.html'
      btn_class: 'btn--outline'

# Define your feature sections here
feature_row:
  - image_path: /assets/e2e-screenshots/05_discover_phase.webp
    alt: 'Discover Phase'
    title: 'Local AI Intelligence'
    excerpt:
      'Built-in AI (node-llama-cpp) to understand file content, not just filenames. Zero data
      exfiltration.'
    url: '/USER_GUIDE.html'
    btn_label: 'Learn More'
    btn_class: 'btn--primary'

  - image_path: /assets/e2e-screenshots/34_organize_phase_ai_suggestions.webp
    alt: 'Organize Phase'
    title: 'Smart Organization'
    excerpt:
      'Review and approve AI-generated suggestions for where each file should be moved and what it
      should be renamed to.'

  - image_path: /assets/e2e-screenshots/03_setup_smart_folders.webp
    alt: 'Smart Folders'
    title: 'Smart Folder Watchers'
    excerpt:
      'Automatically monitor downloads or specific directories and route files based on AI content
      understanding.'

feature_row2:
  - image_path: /assets/e2e-screenshots/36_knowledge_os_indexed.webp
    alt: 'Semantic Search'
    title: 'Semantic Search'
    excerpt:
      'Find files by their meaning and concepts using Orama Vector Search and AI Re-Ranking, even if
      you forgot the exact keywords.'

  - image_path: /assets/e2e-screenshots/46_understand_tab_chat.webp
    alt: 'Chat with Documents'
    title: 'Conversational RAG'
    excerpt:
      'Ask questions about your documents in natural language, and let the AI find the sources and
      summarize the answers for you.'
---

# See StratoSort in Action

{% include feature_row %}

## Semantic Search & Chat

Unlock the knowledge hidden in your messy folders. Search implies meaning.

{% include feature_row id="feature_row2" %}

## Knowledge Graph Visualization

Visualize file relationships using the built-in Knowledge OS graph tool to discover clusters and
connections you didn't know existed.

<p align="center">
  <img src="assets/e2e-screenshots/54_relate_full_graph_legend.webp" alt="Knowledge Graph" width="800" style="border-radius: 10px; box-shadow: 0 4px 8px rgba(0,0,0,0.5);" />
</p>
