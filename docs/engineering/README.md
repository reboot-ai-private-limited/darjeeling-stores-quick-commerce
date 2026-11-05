# Engineering handbook

Use this handbook for work on the current scaffold. Read the owning feature specification before implementing business rules; examples of future architecture do not authorize new business behavior.

| Question | Reference |
| --- | --- |
| How do I start from a clean clone? | [Development setup](setup-development.md) |
| Where does a file belong? | [Repository layout](monorepo-layout.md) and [module anatomy](module-anatomy.md) |
| What dependencies are allowed? | [Clean architecture](clean-architecture.md) and [dependency rules](../architecture/module-dependencies.md) |
| How do SOLID principles apply here? | [Practical SOLID](solid-principles.md) |
| What conventions affect compatibility? | [Coding standards](coding-standards.md) |
| How do workspace commands execute? | [pnpm and task execution](pnpm-and-turbo.md) |
| What does the web client implement? | [Frontend architecture](frontend-architecture.md) |
| Which checks should I run? | [Testing](testing.md) |
| What can be deployed? | [Build and deployment](build-and-deploy.md) |
| How will mobile work be verified? | [Mobile workflow](mobile.md) |

## Contributing a change

1. Read current source and callers, including fixtures, exported types and configuration.
2. Identify the feature owner and unresolved design decisions in the delivery plans.
3. Implement the smallest complete behavior and its appropriate checks. Do not add empty layers for anticipated capabilities.
4. Run focused tests, workspace typechecking and backend boundary checks when backend imports change.
5. Update environment examples, API guidance and current architecture in the same change when their behavior changes.
6. Report exact checks and limitations. A skipped Windows signal test does not count as graceful shutdown verification.

## Documentation changes

Use one H1, descriptive filenames, repository-relative links and fenced code with a language. Mark complete runnable commands separately from illustrative code. Operational instructions name their shell, working directory, prerequisites and expected result. Preserve decision history when replacing a choice.

No repository-wide Markdown formatter, link checker or documentation CI gate is configured at this writing. Manual link review and source comparison are the present controls; automation remains proposed work.
