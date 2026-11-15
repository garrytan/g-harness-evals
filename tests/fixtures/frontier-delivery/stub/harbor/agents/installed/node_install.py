def nvm_node_install_snippet(node_major=22):
    return "nvm install %d && nvm alias default %d" % (node_major, node_major)
