# Praxis product requirements

Version: 0.1.107 · [简体中文](PRD.md)

People should be able to ask an agent for work and open the resulting document, schedule or other app record. Each app defines the meaning, storage and presentation of its records. The workbench handles discovery and navigation. External clients choose their own agent harness.

| User need | Observable behavior |
| --- | --- |
| Find an app and return home | The workbench renders available apps and projects. A managed app provides an accessible Home link on desktop and at phone widths. |
| Understand the result | The app opens its native reader or view. People can browse the underlying evidence and see empty, loading and error states. |
| Delegate a bounded operation | A native account authorizes a client for specific actions and resources. Tool discovery and the server both check grants. Revocation takes effect on subsequent access. |
| Keep personal materials private | Readers validate the owner's session before returning document names or contents. Original files and generated data belong in private storage. |
| Add a local app | An operator can supply a bilingual manifest for a loopback service, then launch that app on their own machine. |
| Work in either language | English is the default. Shipped interface changes carry corresponding Simplified Chinese copy. User-authored material keeps its original language. |

Check these contracts with synthetic data. Third-party services are provisioned separately for managed operation.

## Built-in apps

A standard Praxis distribution includes the maintained workbench apps as independently versioned components. The catalog covers Reminder, Knowledge, Lattice Slides, Travel, TingProof, Memo, Finance, Intelligence, Polaris, Calendar, Matrix Reader, Projects, Letters and Profiles. App access follows the installation and the user’s grants; private data, accounts and working files remain outside the public repository. Individuals, families and organizations can also register their own apps.
