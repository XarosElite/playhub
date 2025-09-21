import React from "react";
import { Modal } from "@mantine/core";

import classes from './AppModal.module.scss';

interface ModalProps {
    header?: string;
    opened: boolean;
    closeHandler: () => void;
    children?: React.ReactElement;
}

const AppModal:React.FC<ModalProps> = ({opened, closeHandler, header, children}) => {
    return(
        <Modal
            onClose={closeHandler}
            opened={opened}
            title={<h2>{header || ''}</h2>}
            size='md'
            overlayProps={{blur: 3}}
            withCloseButton={false}
            closeOnClickOutside={false}
            closeOnEscape={false}
            className={classes.modal}
        >
            {children}
        </Modal>
    );
}

export default AppModal;

