import type { CategoryNode } from '@/lib/categories';

interface CategoryTreeProps {
  nodes: CategoryNode[];
  onEdit: (category: CategoryNode) => void;
  onDelete: (category: CategoryNode) => void;
  deletingId?: string | null;
}

export function CategoryTree({ nodes, onEdit, onDelete, deletingId = null }: CategoryTreeProps) {
  return <ul className="space-y-2">
    {nodes.map((category) => {
      const personal = !category.is_system && category.user_id !== null;
      return <li key={category.id}>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-white p-4 dark:bg-gray-800">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-lg" style={{ backgroundColor: `${category.color ?? '#64748b'}20` }}>{category.icon || '•'}</span>
            <div className="min-w-0"><p className="truncate font-medium">{category.name}</p><p className="text-sm text-gray-500">{category.type === 'expense' ? 'Gasto' : category.type === 'income' ? 'Ingreso' : category.type === 'transfer' ? 'Transferencia' : 'Ahorro'}{' · '}{personal ? 'Personal' : 'Global'}{category.budget_type && ` · ${category.budget_type === 'need' ? 'Necesidad' : category.budget_type === 'want' ? 'Deseo' : 'Ahorro'}`}</p></div>
          </div>
          {personal ? <div className="flex items-center gap-3"><button type="button" onClick={() => onEdit(category)} className="text-sm font-medium text-blue-700 hover:underline">Editar</button><button type="button" onClick={() => onDelete(category)} disabled={deletingId === category.id} className="text-sm font-medium text-red-700 hover:underline disabled:cursor-wait disabled:opacity-50">{deletingId === category.id ? 'Eliminando...' : 'Eliminar'}</button></div> : <span className="text-xs font-medium text-gray-500">Solo lectura</span>}
        </div>
        {category.children.length > 0 && <div className="ml-5 border-l-2 border-gray-200 pl-4 pt-2 dark:border-gray-700"><CategoryTree nodes={category.children} onEdit={onEdit} onDelete={onDelete} deletingId={deletingId} /></div>}
      </li>;
    })}
  </ul>;
}