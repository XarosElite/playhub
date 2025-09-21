const NotFound = () => {
    return (
        <div style={{display: 'flex', flexDirection: 'column',}}>
            NOT FOUND
            <iframe
                style={{width: '100%', height: '100%', 'flex': '1', 'display': 'none'}}
                src="https://www.youtube.com/embed/L8XbI9aJOXk?autoplay=1"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
            />
        </div>
    )
};

export default NotFound;