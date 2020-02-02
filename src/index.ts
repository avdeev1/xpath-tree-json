import XPathAnalyzer, {
    ExprNode,
    StepNode,
    PredicateNode,
    NUMBER,
    LITERAL,
    FUNCTION_CALL,
    RELATIVE_LOCATION_PATH,
    RelativeLocationPathNode,
    OR,
    ABSOLUTE_LOCATION_PATH,
    AND,
    EQUALITY,
    EqualityNode,
    RelationalNode,
    ATTRIBUTE,
    CHILD,
    INEQUALITY,
    GREATER_THAN,
    LESS_THAN,
    GREATER_THAN_OR_EQUAL,
    LESS_THAN_OR_EQUAL,
    POSITION,
    COUNT,
    NOT,
    NODE,
} from 'xpath-analyzer';

type IBaobabTreeItemAttrs = Record<string, unknown>;

interface IBaobabTreeItem {
    id: string;
    name: string;
    attrs: IBaobabTreeItemAttrs;

    children: IBaobabTreeItem[];
    path: string;
    parent: IBaobabTreeItem;
}

interface IState {
    context: IBaobabTreeItem;
    index: number;
    isCondition: boolean;
}

const FuncPredicates = {
    position: POSITION,
    count: COUNT,
    not: NOT,
};

export default class XPathBaobab {
    private baobab: IBaobabTreeItem;
    private state: IState;
    private readonly binaryTypes: Set<string>;
    private pathCounter: Map<string, Set<string>>;

    constructor(baobab: IBaobabTreeItem) {
        this.baobab = baobab;
        this.pathCounter = new Map();

        this.state = {
            context: this.baobab,
            index: 1,
            isCondition: false,
        };

        this.binaryTypes = new Set([
            RELATIVE_LOCATION_PATH,
            ABSOLUTE_LOCATION_PATH,
            OR, EQUALITY, INEQUALITY,
            AND, GREATER_THAN,
            GREATER_THAN_OR_EQUAL,
            LESS_THAN, LESS_THAN_OR_EQUAL,
        ]);
    }

    // Сотрит на тип запроса и озвращает либо массив узлов, либо число (count(//$result))
    private getObjs(query: ExprNode, baobab: IBaobabTreeItem, result = []): Set<IBaobabTreeItem> | number {
        switch (query.type) {
            case OR:
                return new Set([
                    ...this.getObjs(query.lhs, baobab),
                    ...this.getObjs(query.rhs, baobab),
                ]);
            case FUNCTION_CALL:
                // 'count', в будущем будут другие числовые функции
                switch (query.name) {
                    case FuncPredicates.count:
                        return this.count(query.args[0]);
                    default:
                        return new Set();
                }
            case ABSOLUTE_LOCATION_PATH:
                return new Set(this.find(query.steps.reverse(), baobab, result));
            case RELATIVE_LOCATION_PATH:
                return new Set(this.find(query.steps.reverse(), this.state.context, result));
            default:
                return new Set();
        }
    }

    // Возвращает индекс узла, если вызван position() или запрос к индексу через квадратные скобки (//$result[1])
    private getIndex(id: string, path: string | undefined): number {
        if (path === undefined) {
            return 1;
        }
        this.updatePathCounter(id, path);
        return Array.from(this.pathCounter.get(path)!).indexOf(id) + 1;
    }

    // Обновляет мапу с путями, если нужно: если в таблице по указанному пути нет id, то пушит его в конец
    private updatePathCounter(id: string, path: string) {
        if (!this.pathCounter.has(path)) {
            this.pathCounter.set(path, new Set([id]));
            return;
        }
        this.pathCounter.get(path)!.add(id);
    }

    // Осуществляет рекурсивный обход дерева
    private find(steps: StepNode[], baobab: IBaobabTreeItem | undefined, result: IBaobabTreeItem[]): IBaobabTreeItem[] {
        if (baobab === undefined) {
            return result;
        }

        this.state.context = baobab;
        this.state.index = this.getIndex(baobab.id, baobab.path);

        if (this.state.isCondition && baobab.children) {
            baobab.children.forEach(child => {
                this.find(steps, child, result);
            });
            this.state.isCondition = false;
        }

        const step: StepNode | undefined = steps.pop();

        if (step === undefined) {
            return result;
        }

        const name = step.test.name;
        const objName = baobab.name.replace(/^\$/, '');
        let predicates: PredicateNode[] = step.predicates;

        if (objName === name && this.getPredicate(predicates, baobab)) {
            if (steps.length === 0) {
                result.push(baobab);
            } else {
                baobab.children && baobab.children.forEach(child => {
                    this.find(steps, child, result);
                });
            }
        } else if (name === NODE) {
            // если у нас два подряд слеша в запросе (page//result), то есть три варианта:
            // 1. вместо двух слешей может быть ничего (т.е. никакого узла) - page/result
            // 2. вместо двух слешей стоит какая-то одна нода - page/<node_name>/result
            // 3. вместо двух слешей стоит много нод - page/<node_name1>/<node_name2>/.../result
            this.find(steps, baobab, result);
            baobab.children && baobab.children.forEach(child => {
                if (steps.length) {
                    this.find(steps, child, result);
                    const stepsForChild = steps.concat(step);
                    this.find(stepsForChild, child, result);
                }
            });
        }

        // После прохода всех детей узла, нужно удалить индексы детей из таблицы
        if (baobab.path !== undefined) {
            const path = baobab.path;

            for (let key of this.pathCounter.keys()) {
                if (key.startsWith(path) && key.length > path.length) {
                    this.pathCounter.delete(key);
                }
            }
        }

        steps.push(step);
        return result;
    }

    // Унарный предикат - если в условии стоит индекс, проверка на включение или функция not()
    private unaryPredicate(predicate: ExprNode, node: IBaobabTreeItem): boolean {
        switch (predicate.type) {
            case RELATIVE_LOCATION_PATH:
                return this.checkInclude(predicate, node);
            case FUNCTION_CALL:
                switch (predicate.name) {
                    case FuncPredicates.not:
                        return this.not(predicate);
                    default:
                        return false;
                }
            case NUMBER:
                return this.state.index === predicate.number;
            default:
                return false;
        }
    }

    // Функция смотрит, что нужно проверить (аттрибут или ребенка)
    private checkInclude(predicate: RelativeLocationPathNode, node: IBaobabTreeItem) {
        const axis = predicate.steps[0].axis;
        switch (axis) {
            case CHILD:
                return this.checkChilds(predicate, node);
            case ATTRIBUTE:
                return this.checkAttribute(predicate, node);
            default:
                return true;
        }
    }

    // Проверяет наличие у узла ребенка с нужным именем и условиями
    private checkChilds(predicate: RelativeLocationPathNode, node: IBaobabTreeItem) {
        if (!node.children) {
            return false;
        }

        return node.children.some(elem => {
            const isSameName = elem.name === predicate.steps[0].test.name;
            const predicateResult = this.getPredicate(predicate.steps[0].predicates, elem);
            return isSameName && predicateResult;
        });
    }

    // Смотрит наличие поля в node.attributes
    private checkAttribute(predicate: RelativeLocationPathNode, node: IBaobabTreeItem) {
        return node.attrs[predicate.steps[0].test.name!] !== undefined;
    }

    // Предикат с несколькими условиями (or, and, =, <=, etc)
    // Если тип OR или AND вызывается рекурсивно для левой и правой части
    private binaryPredicate(predicate: ExprNode, node: IBaobabTreeItem): boolean {
        switch (predicate.type) {
            case RELATIVE_LOCATION_PATH:
                return this.checkInclude(predicate, node);

            // not()
            case FUNCTION_CALL:
                return this.unaryPredicate(predicate, node);

            case OR:
                return this.binaryPredicate(predicate.lhs, node) || this.binaryPredicate(predicate.rhs, node);

            case AND:
                return this.binaryPredicate(predicate.lhs, node) && this.binaryPredicate(predicate.rhs, node);

            case EQUALITY:
                return this.equal(predicate, node);

            case INEQUALITY:
                return this.inequal(predicate, node);

            case GREATER_THAN:
                return this.greaterThan(predicate, node);

            case LESS_THAN:
                return this.lessThan(predicate, node);

            case GREATER_THAN_OR_EQUAL:
                return this.greaterThanOrEqual(predicate, node);

            case LESS_THAN_OR_EQUAL:
                return this.lessThanOrEqual(predicate, node);

            default:
                return true;
        }
    }

    // Возвращает значение для указанного предиката (count, position, number, literal, name)
    private getType(predicate: ExprNode, node: IBaobabTreeItem): number | string | unknown {
        switch (predicate.type) {
            case FUNCTION_CALL:
                switch (predicate.name) {
                    case FuncPredicates.count:
                        this.state.isCondition = true;
                        return this.count(predicate.args[0]);
                    case FuncPredicates.position:
                        return this.position();
                    default:
                        return 0;
                }
            case NUMBER:
                return predicate.number;
            case LITERAL:
                return predicate.string;
            case RELATIVE_LOCATION_PATH:
                // В данном случае мы ТОЧНО знаем, что у предиката есть непустой steps, а у него поле test: {name}
                return node.attrs[predicate.steps[0].test.name!];
            default:
                return null;
        }
    }

    private equal(predicate: EqualityNode, node: IBaobabTreeItem) {
        return String(this.getType(predicate.lhs, node)) === String(this.getType(predicate.rhs, node));
    }

    private inequal(predicate: EqualityNode, node: IBaobabTreeItem) {
        return String(this.getType(predicate.lhs, node)) !== String(this.getType(predicate.rhs, node));
    }

    private greaterThan(predicate: RelationalNode, node: IBaobabTreeItem) {
        return Number(this.getType(predicate.lhs, node)) > Number(this.getType(predicate.rhs, node));
    }

    private greaterThanOrEqual(predicate: RelationalNode, node: IBaobabTreeItem) {
        return Number(this.getType(predicate.lhs, node)) >= Number(this.getType(predicate.rhs, node));
    }

    private lessThan(predicate: RelationalNode, node: IBaobabTreeItem) {
        return Number(this.getType(predicate.lhs, node)) < Number(this.getType(predicate.rhs, node));
    }

    private lessThanOrEqual(predicate: RelationalNode, node: IBaobabTreeItem): boolean {
        return Number(this.getType(predicate.lhs, node)) <= Number(this.getType(predicate.rhs, node));
    }

    // Функция смотрит на арность (количество аргументов) предиката и вызывает нужную функцию
    private getPredicate(predicates: ExprNode[], node: IBaobabTreeItem): boolean {
        if (predicates.length === 0) {
            return true;
        }
        // библиотека оборачивает preducates в массив, у которого только один элеменит
        const predicate = predicates[0];
        if (this.binaryTypes.has(predicate.type)) {
            return this.binaryPredicate(predicate, node);
        }
        return this.unaryPredicate(predicate, node);
    }

    // Функция xpath
    private position(): number {
        return this.state.index;
    }

    // Функция xpath
    private count(parsed: ExprNode): number {
        const objs = this.getObjs(parsed, this.state.context);

        return typeof objs === 'number' ?
            objs :
            objs.size;
    }

    // Функция xpath
    private not(parsed: ExprNode): boolean {
        return !this.unaryPredicate(parsed, this.state.context);
    }

    parse(expr: string): IBaobabTreeItem[] | number {
        const analyzer = new XPathAnalyzer(expr.replace(/\$/g, ''));
        const result = this.getObjs(analyzer.parse(), this.baobab, []);

        return typeof result === 'number' ?
            result :
            Array.from(result);
    }
}
