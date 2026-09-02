export interface CategoryItem {
  id: string;
  parent_id: string | null;
  name: string;
  type: string;
  budget_type: string | null;
  icon: string | null;
  color: string | null;
  is_system: boolean;
  sort_order: number;
  user_id: string | null;
}

export interface CategoryNode extends CategoryItem {
  children: CategoryNode[];
}

export function buildCategoryTree(categories: CategoryItem[]): CategoryNode[] {
  const nodes = new Map<string, CategoryNode>(
    categories.map((category) => [category.id, { ...category, children: [] }])
  );
  const roots: CategoryNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parent_id ? nodes.get(node.parent_id) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const sortNodes = (items: CategoryNode[]) => {
    items.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'es'));
    items.forEach((item) => sortNodes(item.children));
  };
  sortNodes(roots);
  return roots;
}

export function flattenCategoryTree(nodes: CategoryNode[], depth = 0): Array<CategoryNode & { depth: number }> {
  return nodes.flatMap((node) => [{ ...node, depth }, ...flattenCategoryTree(node.children, depth + 1)]);
}

export function getCategoryDescendantIds(categoryId: string, categories: CategoryItem[]): Set<string> {
  const descendants = new Set<string>();
  const collect = (parentId: string) => {
    categories.filter((category) => category.parent_id === parentId).forEach((child) => {
      descendants.add(child.id);
      collect(child.id);
    });
  };
  collect(categoryId);
  return descendants;
}